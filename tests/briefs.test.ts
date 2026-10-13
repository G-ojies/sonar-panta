import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoSettlement, guarantee, ledgerStats, outcomeOf, sellable, freezeCall, type Brief } from '../src/lib/briefs';
import { client, firstCapture, approveUrl, usd, type PayPalConfig } from '../src/lib/paypal';
import type { RadarMarket } from '../src/lib/types';
import { market, T0 } from './helpers';

const radar = (side: 'YES' | 'NO' | 'FLAT', extra: Parameters<typeof market>[1] = {}): RadarMarket => ({
  detail: market(7 * 86400, { title: 'Will it rain in Benin City on Friday?', ...extra }), yesPrice: 0.42, tape: [], venue: null, tradable: true, updatedAt: T0,
  signals: { flowImbalance: 0.5, momentum: 0.04, whaleShare: 0.2, concentration: 0.3, velocity: 1, staleness: 600, timeToClose: 86400, crossVenueGap: null, score: side === 'NO' ? -41 : 41, side, confidence: 'medium', reasons: ['YES flow 62% of last 9 prints'] },
} as RadarMarket);

const paid = (side: 'YES' | 'NO', over: Partial<Brief> = {}): Brief => ({
  id: 'b1', marketId: 'mkt', title: 'Will it rain in Benin City on Friday?', call: freezeCall(radar(side)), priceCents: 199,
  orderId: 'O1', captureId: 'C1', createdAt: T0, paidAt: T0, status: 'paid', via: 'button', ...over,
});

test('briefs: only markets with a live call are for sale', () => {
  assert.deepEqual(sellable(radar('YES'), T0), { ok: true });
  assert.equal(sellable(radar('FLAT'), T0).ok, false);
  assert.equal(sellable(radar('YES', { phase: 'resolved' }), T0).ok, false);
  assert.equal(sellable(radar('YES'), T0 + 8 * 86400).ok, false);
  assert.equal(sellable(null).ok, false);
});

test('briefs: the call is frozen at purchase, including a NO call', () => {
  const c = freezeCall(radar('NO'));
  assert.equal(c.side, 'NO');
  assert.equal(c.score, -41);
  assert.equal(c.yesPrice, 0.42);
});

test('briefs: outcome follows the chain, then the settled price', () => {
  assert.equal(outcomeOf(market()), null);
  assert.equal(outcomeOf(market(0, { onChain: { isResolved: true, yesWins: true } } as never)), 'YES');
  assert.equal(outcomeOf(market(0, { phase: 'resolved', yesPrice: '0' } as never)), 'NO');
  assert.equal(outcomeOf(market(0, { phase: 'cancelled' } as never)), 'CANCELLED');
});

test('guarantee: a wrong call or a cancelled market is refunded, a right call is kept', () => {
  const yesWon = market(0, { onChain: { isResolved: true, yesWins: true } } as never);
  assert.equal(guarantee(paid('YES'), yesWon).kind, 'keep');
  const wrong = guarantee(paid('NO'), yesWon);
  assert.equal(wrong.kind, 'refund');
  assert.match(wrong.kind === 'refund' ? wrong.note : '', /called NO .* resolved YES/);
  assert.equal(guarantee(paid('YES'), market(0, { phase: 'cancelled' } as never)).kind, 'refund');
});

test('guarantee: nothing happens before payment, before settlement, or without a capture', () => {
  const yesWon = market(0, { onChain: { isResolved: true, yesWins: true } } as never);
  assert.equal(guarantee(paid('NO', { status: 'pending' }), yesWon).kind, 'wait');
  assert.equal(guarantee(paid('NO', { captureId: undefined }), yesWon).kind, 'wait');
  assert.equal(guarantee(paid('NO'), market()).kind, 'wait');
  assert.equal(guarantee(paid('NO', { status: 'refunded' }), yesWon).kind, 'wait');
});

test('ledger: hit rate and refunded money', () => {
  const s = ledgerStats([paid('YES', { status: 'kept' }), paid('NO', { status: 'refunded' }), paid('YES'), paid('YES', { status: 'pending' })]);
  assert.deepEqual(s, { sold: 3, open: 1, right: 1, refunded: 1, missed: 0, refundedCents: 199, keptCents: 199, hitRate: 0.5 });
});

const cfg: PayPalConfig = { clientId: 'id', clientSecret: 'secret', env: 'sandbox' };
function fakeFetch(routes: Record<string, (init: RequestInit) => [number, unknown]>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => url.endsWith(k) || new RegExp(k).test(url));
    const [status, body] = key ? routes[key](init) : [404, { name: 'NOT_FOUND' }];
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { f, calls };
}

test('paypal: one token for many calls, server-side price, idempotent create', async () => {
  const { f, calls } = fakeFetch({
    '/v1/oauth2/token': () => [200, { access_token: 'tok', expires_in: 3600 }],
    '/v2/checkout/orders$': (init) => [201, { id: 'O1', status: 'PAYER_ACTION_REQUIRED', links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=O1' }], echo: JSON.parse(String(init.body)) }],
  });
  const c = client(cfg, f);
  const o = await c.createOrder({ referenceId: 'mkt', customId: 'brief:b1', description: 'Sonar brief', cents: 199, requestId: 'b1' });
  await c.createOrder({ referenceId: 'mkt', customId: 'brief:b2', description: 'Sonar brief', cents: 199, requestId: 'b2' });
  assert.equal(calls.filter((x) => x.url.endsWith('/v1/oauth2/token')).length, 1);
  assert.equal(approveUrl(o), 'https://www.sandbox.paypal.com/checkoutnow?token=O1');
  const create = calls.find((x) => x.url.endsWith('/v2/checkout/orders'))!;
  assert.equal((create.init.headers as Record<string, string>)['PayPal-Request-Id'], 'b1');
  assert.equal(JSON.parse(String(create.init.body)).purchase_units[0].amount.value, '1.99');
  assert.ok(create.url.startsWith('https://api-m.sandbox.paypal.com'));
});

test('paypal: errors carry the PayPal issue, refunds are keyed by capture', async () => {
  const { f, calls } = fakeFetch({
    '/v1/oauth2/token': () => [200, { access_token: 'tok', expires_in: 3600 }],
    '/capture$': () => [422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_NOT_APPROVED', description: 'Payer has not yet approved the Order for payment.' }], debug_id: 'd1' }],
    '/refund$': () => [201, { id: 'R1', status: 'COMPLETED' }],
  });
  const c = client(cfg, f);
  await assert.rejects(c.captureOrder('O1'), (e: { status: number; issue: string }) => e.status === 422 && e.issue === 'ORDER_NOT_APPROVED');
  const r = await c.refundCapture('C1', 'Wrong call, full refund.');
  assert.equal(r.status, 'COMPLETED');
  const refund = calls.find((x) => x.url.endsWith('/refund'))!;
  assert.equal((refund.init.headers as Record<string, string>)['PayPal-Request-Id'], 'refund-C1');
  assert.equal(JSON.parse(String(refund.init.body)).amount, undefined);
});

test('paypal: helpers', () => {
  assert.equal(usd(199), '1.99');
  assert.equal(usd(5), '0.05');
  assert.equal(firstCapture({ id: 'O', status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: 'C9', status: 'COMPLETED', amount: { currency_code: 'USD', value: '1.99' } }] } }] })?.id, 'C9');
  assert.equal(firstCapture({ id: 'O', status: 'CREATED' }), null);
});

test('guarantee: a Sonar Pro brief has nothing to refund, so a wrong call is recorded as missed', () => {
  const yesWon = market(0, { onChain: { isResolved: true, yesWins: true } } as never);
  const pro = (side: 'YES' | 'NO') => paid(side, { via: 'pro', subscriptionId: 'I-1', captureId: undefined, priceCents: 0 });
  assert.equal(guarantee(pro('YES'), yesWon).kind, 'keep');
  assert.equal(guarantee(pro('NO'), yesWon).kind, 'miss');
  assert.equal(guarantee(pro('NO'), market()).kind, 'wait');
  assert.equal(ledgerStats([{ ...pro('NO'), status: 'missed' }, { ...pro('YES'), status: 'kept' }]).hitRate, 0.5);
});

test('demo settlement: refunds against the call by default, says so to the payer, and stays out of the record', () => {
  const a = demoSettlement(paid('YES'));
  assert.equal(a.kind, 'refund');
  if (a.kind !== 'refund') return;
  assert.equal(a.brief.outcome, 'NO');
  assert.equal(a.brief.demo, true);
  assert.ok(a.note.startsWith('[Sandbox demo, simulated outcome]'));
  assert.equal(demoSettlement(paid('NO'), 'NO').kind, 'keep');
  assert.equal(demoSettlement(paid('YES'), 'CANCELLED').kind, 'refund');
  assert.equal(demoSettlement(paid('YES', { status: 'pending' })).kind, 'refuse');
  assert.equal(demoSettlement(paid('YES', { status: 'refunded' })).kind, 'refuse');
  assert.equal(demoSettlement(paid('YES', { captureId: undefined, via: 'pro', subscriptionId: 'I-1', priceCents: 0 })).kind, 'refuse');
  const s = ledgerStats([{ ...a.brief, status: 'refunded' }, paid('YES', { status: 'kept' })]);
  assert.equal(s.refunded, 0);
  assert.equal(s.sold, 1);
  assert.equal(s.hitRate, 1);
});
