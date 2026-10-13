'use client';
import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import type { SignalSet } from '@/lib/types';
import { postJson } from './useApi';
import { getPro, setPro } from './pro';

/** Sonar Desk: buy the brief behind Sonar's call with PayPal (JS SDK v6). Refunded automatically if the call is wrong. */

interface BriefText { headline: string; body: string[]; risks: string[]; via: 'groq' | 'template' }
interface BriefRow { id: string; status: 'pending' | 'paid' | 'refunded' | 'kept' | 'missed'; call: { side: 'YES' | 'NO'; score: number }; outcome?: string; refundId?: string; via?: string; demo?: boolean }
interface OrderRes { orderId: string; approveUrl: string | null; briefId: string; priceCents: number }

interface V6Session { start(opts: { presentationMode: 'auto' | 'popup' | 'modal' | 'redirect' }, order: Promise<{ orderId: string }>): Promise<void> }
interface V6Sdk {
  findEligibleMethods(o: { currencyCode: string }): Promise<{ isEligible(m: string): boolean }>;
  createPayPalOneTimePaymentSession(h: { onApprove(d: { orderId: string }): Promise<void> | void; onCancel?(): void; onError?(e: Error): void }): V6Session;
}
declare global { interface Window { paypal?: { createInstance(o: { clientId: string; components: string[]; pageType?: string }): Promise<V6Sdk> } } }

const CLIENT_ID = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ?? '';
const SDK_URL = process.env.NEXT_PUBLIC_PAYPAL_ENV === 'live' ? 'https://www.paypal.com/web-sdk/v6/core' : 'https://www.sandbox.paypal.com/web-sdk/v6/core';
const keyFor = (marketId: string) => `sonar:brief:${marketId}`;

let sdkPromise: Promise<V6Sdk> | null = null;
function loadSdk(): Promise<V6Sdk> {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<void>((ok, bad) => {
    if (window.paypal) return ok();
    const s = document.createElement('script');
    s.src = SDK_URL; s.async = true; s.onload = () => ok(); s.onerror = () => bad(new Error('PayPal SDK did not load'));
    document.head.appendChild(s);
  }).then(() => window.paypal!.createInstance({ clientId: CLIENT_ID, components: ['paypal-payments'], pageType: 'product-details' }));
  sdkPromise.catch(() => { sdkPromise = null; });
  return sdkPromise;
}

const remember = (marketId: string, orderId: string | null) => { try { if (orderId) localStorage.setItem(keyFor(marketId), orderId); else localStorage.removeItem(keyFor(marketId)); } catch { /* private mode */ } };
const recall = (marketId: string) => { try { return localStorage.getItem(keyFor(marketId)); } catch { return null; } };

export function BriefPanel({ marketId, side, closed }: { marketId: string; side: SignalSet['side']; closed: boolean }) {
  const [session, setSession] = useState<V6Session | null>(null);
  const [sdkErr, setSdkErr] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [approveUrl, setApproveUrl] = useState<string | null>(null);
  const [brief, setBrief] = useState<BriefRow | null>(null);
  const [text, setText] = useState<BriefText | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const btnRef = useRef<HTMLElement | null>(null);

  const capture = useCallback(async (id: string) => {
    setBusy(true); setErr(null);
    try {
      const r = await postJson<{ brief: BriefRow; text: BriefText | null }>('/api/pay/capture', { orderId: id });
      setBrief(r.brief); setText(r.text); remember(marketId, id);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }, [marketId]);

  // a brief bought earlier on this browser opens straight away
  useEffect(() => {
    const id = recall(marketId);
    if (!id) return;
    fetch(`/api/brief?order=${encodeURIComponent(id)}`).then((r) => (r.ok ? r.json() : null)).then((j) => {
      if (!j?.brief) return remember(marketId, null);
      setOrderId(id);
      if (j.brief.status === 'pending') return;
      setBrief(j.brief); setText(j.text);
    }).catch(() => {});
  }, [marketId]);

  useEffect(() => {
    if (!CLIENT_ID || closed || side === 'FLAT') return;
    let live = true;
    loadSdk().then(async (sdk) => {
      const m = await sdk.findEligibleMethods({ currencyCode: 'USD' });
      if (!live || !m.isEligible('paypal')) return;
      setSession(sdk.createPayPalOneTimePaymentSession({
        onApprove: async (d) => { await capture(d.orderId); },
        onCancel: () => setBusy(false),
        onError: (e) => { setErr(e.message); setBusy(false); },
      }));
    }).catch((e) => live && setSdkErr((e as Error).message));
    return () => { live = false; };
  }, [capture, closed, side]);

  const createOrder = useCallback(async (): Promise<{ orderId: string }> => {
    const r = await postJson<OrderRes>('/api/pay/order', { marketId });
    setOrderId(r.orderId); setApproveUrl(r.approveUrl); remember(marketId, r.orderId);
    return { orderId: r.orderId };
  }, [marketId]);

  const [pro, setProId] = useState<string | null>(null);
  useEffect(() => { setProId(getPro()); }, []);

  const readWithPro = useCallback(async (sub: string) => {
    setErr(null); setBusy(true);
    try {
      const r = await postJson<{ orderId: string; brief: BriefRow; text: BriefText }>('/api/pay/order', { marketId, subscriptionId: sub });
      setBrief(r.brief); setText(r.text); remember(marketId, r.orderId);
    } catch (e) {
      const m = (e as Error).message;
      if (/PRO_INACTIVE/.test(m)) { setPro(null); setProId(null); }
      setErr(m);
    } finally { setBusy(false); }
  }, [marketId]);

  const pay = useCallback(async () => {
    setErr(null); setBusy(true);
    try {
      if (session) await session.start({ presentationMode: 'popup' }, createOrder());
      else { await createOrder(); setBusy(false); }
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }, [createOrder, session]);

  // <paypal-button> is a web component; React 18 needs a native listener for its click
  useEffect(() => {
    const el = btnRef.current;
    if (!el) return;
    const h = () => { void pay(); };
    el.addEventListener('click', h);
    return () => el.removeEventListener('click', h);
  }, [pay, session]);

  if (side === 'FLAT' && !brief) return null;

  return (
    <section className="card p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Sonar Desk brief</h2>
        <span className="mono text-xs text-fog">$1.99 · PayPal</span>
      </div>

      {text && brief ? (
        <div className="mt-3 space-y-3 text-sm">
          <p className="font-medium text-paper">{text.headline}</p>
          <ul className="space-y-1.5 text-fog">{text.body.map((b, i) => <li key={i}>{b}</li>)}</ul>
          <div className="border-t border-line pt-2 text-xs text-fog-2">{text.risks.map((r, i) => <p key={i}>{r}</p>)}</div>
          <p className="text-xs">
            {brief.status === 'paid' && (brief.via === 'pro' ? <span className="text-ping">Included in Sonar Pro.</span> : <span className="text-ping">Guarantee open: refunded through PayPal if the market resolves against {brief.call.side}.</span>)}
            {brief.status === 'kept' && <span className="text-yes">Call was right ({brief.outcome}).</span>}
            {brief.status === 'refunded' && <span className="text-amber">{brief.demo ? `Sandbox demo: simulated outcome ${brief.outcome}, so the call was wrong; refunded to your PayPal.` : `Call was wrong (${brief.outcome}); refunded to your PayPal.`}</span>}
            {brief.status === 'missed' && <span className="text-amber">Call was wrong ({brief.outcome}). Covered by Sonar Pro.</span>}
          </p>
          <p className="text-[11px] text-fog-2">Written by {text.via === 'groq' ? 'gpt-oss on Groq from Sonar’s own numbers' : 'Sonar’s template'}.</p>
        </div>
      ) : closed ? (
        <p className="mt-3 text-sm text-fog">This market has closed, so new briefs are not sold.</p>
      ) : (
        <div className="mt-3 space-y-3 text-sm">
          <p className="text-fog">Sonar leans <strong className={side === 'YES' ? 'text-yes' : 'text-no'}>{side}</strong>. The brief explains why, from the tape, the price path and other venues. <span className="text-paper">If the call is wrong when the market resolves, you get the $1.99 back automatically.</span></p>
          {pro && <button className="btn btn-primary w-full" disabled={busy} onClick={() => void readWithPro(pro)}>Read it with Sonar Pro</button>}
          {!pro && <p className="text-[11px] text-fog-2">Or get every brief with <a href="/desk#pro">Sonar Pro</a>, $7.99 a month.</p>}
          {session
            ? createElement('paypal-button', { ref: btnRef, type: 'pay', class: busy ? 'opacity-60' : '' })
            : <button className="btn w-full" onClick={() => void pay()} disabled={busy || !CLIENT_ID}>{CLIENT_ID ? 'Buy with PayPal' : 'PayPal not configured'}</button>}
          {(!session || err) && orderId && approveUrl && (
            <div className="space-y-2 text-xs text-fog">
              <a className="btn w-full text-center" href={approveUrl} target="_blank" rel="noopener noreferrer">Approve in PayPal ↗</a>
              <button className="btn w-full" disabled={busy} onClick={() => void capture(orderId)}>I approved it: unlock the brief</button>
            </div>
          )}
          {sdkErr && <p className="text-xs text-fog-2">PayPal buttons unavailable ({sdkErr}); the approve link works the same.</p>}
        </div>
      )}
      {busy && <p className="mt-2 text-xs text-fog">Working…</p>}
      {err && <p className="mt-2 text-xs text-no">{err}</p>}
    </section>
  );
}
