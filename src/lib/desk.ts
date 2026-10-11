/**
 * Sonar Desk server side: brief storage, checkout (create order -> capture -> write the brief) and the guarantee
 * sweep that refunds wrong calls. Routes and the agent call these; PayPal and the store are passed in where tests need it.
 */
import { randomUUID } from 'crypto';
import { BRIEF_PRICE_CENTS, freezeCall, guarantee, sellable, type Brief } from './briefs';
import { approveUrl, client, firstCapture, paypalConfig, PayPalError, type PayPalClient, type Subscription } from './paypal';
import { readMarket } from './radar';
import { store } from './store';
import type { MarketDetail, RadarMarket } from './types';

const K = {
  brief: (id: string) => `desk:brief:${id}`,
  byOrder: (orderId: string) => `desk:order:${orderId}`,
  text: (id: string) => `desk:text:${id}`,
  list: 'desk:briefs',
  session: (s: string) => `desk:session:${s}`,
  pro: (id: string) => `desk:pro:${id}`,
};

export function paypal(): PayPalClient {
  const cfg = paypalConfig();
  if (!cfg) throw new PayPalError(503, 'NOT_CONFIGURED', 'PayPal is not configured (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET)');
  return client(cfg);
}

export const readBrief = (id: string) => store().get<Brief>(K.brief(id));
export async function briefByOrder(orderId: string) { const id = await store().get<string>(K.byOrder(orderId)); return id ? readBrief(id) : null; }
export const saveBrief = (b: Brief) => store().set(K.brief(b.id), b);
export const readBriefText = (id: string) => store().get<BriefText>(K.text(id));

/** A brief as the buyer's browser may see it: no payer email, no capture id. */
export function publicBrief(b: Brief) { const { payer: _p, captureId: _c, ...rest } = b; return rest; }

export async function listBriefs(limit = 200): Promise<Brief[]> {
  const ids = await store().lrange<string>(K.list, 0, limit - 1);
  const rows = await store().mget<Brief>(ids.map(K.brief));
  return rows.filter((b): b is Brief => !!b);
}

export async function sessionBriefs(session: string): Promise<Brief[]> {
  const ids = await store().lrange<string>(K.session(session), 0, 99);
  return (await store().mget<Brief>(ids.map(K.brief))).filter((b): b is Brief => !!b);
}

/** Step 1: freeze Sonar's call and open a PayPal order for it. The buyer approves it in PayPal. */
export async function openBrief(marketId: string, via: Brief['via'] = 'button', pp: PayPalClient = paypal(), m?: RadarMarket | null, opts: { session?: string; returnUrl?: string } = {}) {
  const market = m === undefined ? await readMarket(marketId) : m;
  const ok = sellable(market);
  if (!ok.ok) throw new PayPalError(409, 'NOT_SELLABLE', ok.reason);
  const mk = market!;
  const id = randomUUID();
  const title = mk.detail.title || mk.detail.question || marketId;
  const order = await pp.createOrder({ referenceId: marketId.slice(0, 256), customId: `brief:${id}`, description: `Sonar brief: ${title}`, cents: BRIEF_PRICE_CENTS, requestId: `brief-${id}`, returnUrl: opts.returnUrl, cancelUrl: opts.returnUrl ? `${opts.returnUrl}${opts.returnUrl.includes('?') ? '&' : '?'}cancelled=1` : undefined });
  const b: Brief = { id, marketId, title, call: freezeCall(mk), priceCents: BRIEF_PRICE_CENTS, orderId: order.id, createdAt: Date.now() / 1000, status: 'pending', via, ...(opts.session ? { session: opts.session } : {}) };
  await Promise.all([saveBrief(b), store().set(K.byOrder(order.id), id), store().lpush(K.list, id, 5000), ...(opts.session ? [store().lpush(K.session(opts.session), id, 100)] : [])]);
  return { brief: b, orderId: order.id, approveUrl: approveUrl(order) };
}

/** Step 2: after the buyer approves, capture, mark paid and write the brief. Safe to call twice. */
export async function captureBrief(orderId: string, pp: PayPalClient = paypal()) {
  const b = await briefByOrder(orderId);
  if (!b) throw new PayPalError(404, 'UNKNOWN_ORDER', 'no brief for this order');
  if (b.status !== 'pending') return { brief: b, text: await readBriefText(b.id) };
  const order = await pp.captureOrder(orderId);
  const cap = firstCapture(order);
  if (order.status !== 'COMPLETED' || !cap) throw new PayPalError(402, 'NOT_CAPTURED', `order is ${order.status}`);
  const paidBrief: Brief = { ...b, status: 'paid', captureId: cap.id, payer: order.payer?.email_address, paidAt: Date.now() / 1000 };
  await saveBrief(paidBrief);
  const text = await writeBrief(paidBrief, await readMarket(b.marketId));
  await store().set(K.text(b.id), text);
  return { brief: paidBrief, text };
}

export interface BriefText { headline: string; body: string[]; risks: string[]; via: 'groq' | 'template'; writtenAt: number }

const pct = (x: number | null | undefined) => (x === null || x === undefined ? 'n/a' : `${Math.round(x * 100)}%`);

export function templateBrief(b: Brief, m: RadarMarket | null): BriefText {
  const s = m?.signals;
  const price = b.call.side === 'YES' ? b.call.yesPrice : b.call.yesPrice === null ? null : 1 - b.call.yesPrice;
  return {
    headline: `Sonar calls ${b.call.side} on "${b.title}" (score ${b.call.score}, ${b.call.confidence} confidence)`,
    body: [
      `At the moment you bought this brief the market priced YES at ${pct(b.call.yesPrice)}; the ${b.call.side} side cost ${pct(price)}.`,
      ...b.call.reasons.map((r) => `Signal: ${r}.`),
      s ? `Tape: ${s.velocity.toFixed(1)} trades an hour over the last 6 hours, top wallet share ${pct(s.concentration)}.` : '',
      m?.venue ? `Cross-venue: ${m.venue.venue} has YES at ${pct(m.venue.yesPrice)}.` : '',
    ].filter(Boolean),
    risks: ['Thin markets move on a single print.', 'If this call is wrong when the market resolves, the brief is refunded through PayPal automatically.'],
    via: 'template', writtenAt: Date.now() / 1000,
  };
}

/** Groq (free tier, OpenAI-compatible) writes from Sonar's own numbers only; no key or any error falls back to the template. */
export async function writeBrief(b: Brief, m: RadarMarket | null, fetchImpl: typeof fetch = fetch): Promise<BriefText> {
  const key = process.env.GROQ_API_KEY;
  const base = templateBrief(b, m);
  if (!key) return base;
  const facts = {
    question: b.title, rule: m?.detail.resolutionRule ?? null, closes: m ? new Date(Number(m.detail.endTime) * 1000).toISOString() : null,
    call: b.call, signals: m?.signals ?? null, venue: m?.venue ?? null, recentPrints: (m?.tape ?? []).slice(0, 12).map((t) => ({ side: t.side, shares: t.shares, at: t.blockTime })),
  };
  try {
    const res = await fetchImpl('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL ?? 'openai/gpt-oss-120b', temperature: 0.2, response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'You write short trading briefs for one prediction market. Use only the JSON facts given; never invent numbers, news or sources. Plain English for a newcomer, no hype, no financial advice. Write fractions as percentages and durations in minutes, hours or days; never print raw field names (say \"one wallet holds 48% of the volume\", not \"concentration 0.479\"). Return JSON: {"headline": string, "body": string[3-5], "risks": string[2-3]}.' },
          { role: 'user', content: JSON.stringify(facts) },
        ],
      }),
    });
    if (!res.ok) return base;
    const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const out = JSON.parse(j.choices?.[0]?.message?.content ?? '{}') as Partial<BriefText>;
    if (!out.headline || !Array.isArray(out.body) || !out.body.length) return base;
    const risks = [...(Array.isArray(out.risks) ? out.risks.slice(0, 3) : []), base.risks[1]];
    return { headline: String(out.headline).slice(0, 200), body: out.body.slice(0, 5).map(String), risks, via: 'groq', writtenAt: Date.now() / 1000 };
  } catch { return base; }
}

/** The guarantee sweep: settle every paid brief whose market resolved, refunding wrong calls through PayPal. */
export async function sweepGuarantee(pp: PayPalClient = paypal(), detail: (id: string) => Promise<MarketDetail | null> = async (id) => (await readMarket(id))?.detail ?? null) {
  const out = { refunded: 0, kept: 0, missed: 0, waiting: 0, errors: [] as string[] };
  for (const b of (await listBriefs()).filter((x) => x.status === 'paid')) {
    const a = guarantee(b, await detail(b.marketId));
    if (a.kind === 'wait') { out.waiting++; continue; }
    if (a.kind === 'keep') { await saveBrief({ ...a.brief, status: 'kept', settledAt: Date.now() / 1000 }); out.kept++; continue; }
    if (a.kind === 'miss') { await saveBrief({ ...a.brief, status: 'missed', settledAt: Date.now() / 1000 }); out.missed++; continue; }
    try {
      const r = await pp.refundCapture(b.captureId!, a.note);
      await saveBrief({ ...a.brief, status: 'refunded', refundId: r.id, settledAt: Date.now() / 1000 });
      out.refunded++;
    } catch (e) { out.errors.push(`${b.id}: ${(e as Error).message}`); }
  }
  return out;
}

// --- Sonar Pro: $7.99 a month through PayPal Subscriptions, unlimited briefs ---
export const PRO_PRICE_CENTS = 799;
export interface ProStatus { subscriptionId: string; status: Subscription['status']; active: boolean; checkedAt: number; nextBilling?: string }

/** Start a subscription to the plan made by scripts/desk-setup.ts; the buyer approves it in PayPal. */
export async function startPro(returnUrl: string, pp: PayPalClient = paypal()) {
  const plan = process.env.PAYPAL_PLAN_ID;
  if (!plan) throw new PayPalError(503, 'NOT_CONFIGURED', 'Sonar Pro is not set up (PAYPAL_PLAN_ID)');
  const sub = await pp.createSubscription(plan, returnUrl, `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}cancelled=1`, `pro-${randomUUID()}`);
  return { subscriptionId: sub.id, approveUrl: approveUrl(sub as never) };
}

/** Ask PayPal whether a subscription is live and on our plan. Cached for ten minutes; webhooks refresh it sooner. */
export async function proStatus(subscriptionId: string, pp: PayPalClient = paypal(), fresh = false): Promise<ProStatus> {
  const cached = fresh ? null : await store().get<ProStatus>(K.pro(subscriptionId));
  if (cached && Date.now() / 1000 - cached.checkedAt < 600) return cached;
  const sub = await pp.getSubscription(subscriptionId);
  const plan = process.env.PAYPAL_PLAN_ID;
  const st: ProStatus = { subscriptionId, status: sub.status, active: sub.status === 'ACTIVE' && (!plan || sub.plan_id === plan), checkedAt: Date.now() / 1000, nextBilling: sub.billing_info?.next_billing_time };
  await store().set(K.pro(subscriptionId), st, 7 * 86400);
  return st;
}

/** A brief covered by Sonar Pro: no order, paid at once, tracked by the same record (a wrong call is "missed"). */
export async function openProBrief(marketId: string, subscriptionId: string, pp: PayPalClient = paypal(), m?: RadarMarket | null) {
  if (!/^I-[A-Z0-9]{6,30}$/.test(subscriptionId)) throw new PayPalError(400, 'PRO_INACTIVE', 'not a PayPal subscription id');
  const st = await proStatus(subscriptionId, pp);
  if (!st.active) throw new PayPalError(402, 'PRO_INACTIVE', `subscription is ${st.status}`);
  const market = m === undefined ? await readMarket(marketId) : m;
  const ok = sellable(market);
  if (!ok.ok) throw new PayPalError(409, 'NOT_SELLABLE', ok.reason);
  const id = randomUUID();
  const b: Brief = { id, marketId, title: market!.detail.title || market!.detail.question || marketId, call: freezeCall(market!), priceCents: 0, orderId: `pro-${id}`, createdAt: Date.now() / 1000, paidAt: Date.now() / 1000, status: 'paid', via: 'pro', subscriptionId };
  const text = await writeBrief(b, market!);
  await Promise.all([saveBrief(b), store().set(K.byOrder(b.orderId), id), store().lpush(K.list, id, 5000), store().set(K.text(id), text)]);
  return { brief: b, text };
}

/** Webhook side: keep briefs and Pro status in step with what PayPal reports. */
export async function onPayPalEvent(ev: { event_type?: string; resource?: Record<string, unknown> }, pp: PayPalClient = paypal()) {
  const r = (ev.resource ?? {}) as Record<string, any>;
  switch (ev.event_type) {
    case 'CHECKOUT.ORDER.APPROVED': {
      // the buyer approved but closed the tab before we captured: capture here so they still get the brief
      const b = await briefByOrder(String(r.id));
      if (b?.status === 'pending') await captureBrief(b.orderId, pp);
      return 'captured';
    }
    case 'PAYMENT.CAPTURE.REFUNDED': {
      const orderId = r.supplementary_data?.related_ids?.order_id;
      const b = orderId ? await briefByOrder(String(orderId)) : null;
      if (b && b.status !== 'refunded') await saveBrief({ ...b, status: 'refunded', settledAt: b.settledAt ?? Date.now() / 1000 });
      return 'refund recorded';
    }
    case 'BILLING.SUBSCRIPTION.ACTIVATED': case 'BILLING.SUBSCRIPTION.CANCELLED': case 'BILLING.SUBSCRIPTION.SUSPENDED': case 'BILLING.SUBSCRIPTION.EXPIRED':
      if (r.id) await proStatus(String(r.id), pp, true);
      return 'subscription refreshed';
    default:
      return 'ignored';
  }
}

export const WEBHOOK_EVENTS = ['CHECKOUT.ORDER.APPROVED', 'PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.CAPTURE.REFUNDED', 'BILLING.SUBSCRIPTION.ACTIVATED', 'BILLING.SUBSCRIPTION.CANCELLED', 'BILLING.SUBSCRIPTION.SUSPENDED', 'BILLING.SUBSCRIPTION.EXPIRED'];
