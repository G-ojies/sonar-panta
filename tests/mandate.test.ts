import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidates, committed, mayBuy, parseMandate, DEFAULT_MANDATE } from '../src/lib/mandate';
import type { Brief } from '../src/lib/briefs';
import type { RadarMarket } from '../src/lib/types';
import { market, T0 } from './helpers';

const mk = (id: string, score: number, category = 'crypto', closesIn = 3 * 86400): RadarMarket => ({
  detail: market(closesIn, { marketId: id, title: `Market ${id}`, category } as never), yesPrice: 0.4, tape: [], venue: null, tradable: true, updatedAt: T0,
  signals: { flowImbalance: 0, momentum: null, whaleShare: 0, concentration: 0, velocity: 0, staleness: null, timeToClose: closesIn, crossVenueGap: null, score, side: score > 0 ? 'YES' : score < 0 ? 'NO' : 'FLAT', confidence: 'medium', reasons: [] },
} as RadarMarket);
const brief = (marketId: string, status: Brief['status'] = 'pending'): Brief => ({ id: marketId, marketId, title: '', call: { side: 'YES', score: 30, confidence: 'medium', yesPrice: 0.4, reasons: [] }, priceCents: 199, orderId: 'O', createdAt: T0, status, via: 'agent', session: 's1' });

test('mandate: browser input is clamped to safe limits', () => {
  assert.deepEqual(parseMandate(null), DEFAULT_MANDATE);
  const m = parseMandate({ maxCents: 1e9, categories: ['Crypto', 7], minScore: -5, minHoursLeft: 'x' });
  assert.equal(m.maxCents, 2000);
  assert.deepEqual(m.categories, ['crypto']);
  assert.equal(m.minScore, 0);
  assert.equal(m.minHoursLeft, DEFAULT_MANDATE.minHoursLeft);
});

test('mandate: candidates respect category, strength and time left, strongest first', () => {
  const ms = [mk('a', 25), mk('b', -60), mk('c', 90, 'sports'), mk('d', 10), mk('e', 70, 'crypto', 3600), mk('f', 0)];
  const m = parseMandate({ categories: ['crypto'], minScore: 20, minHoursLeft: 6 });
  assert.deepEqual(candidates(ms, m, T0).map((c) => c.marketId), ['b', 'a']);
  assert.equal(candidates(ms, m, T0)[0].side, 'NO');
});

test('mandate: the budget counts pending and paid briefs, not refunded ones', () => {
  assert.equal(committed([brief('a'), brief('b', 'paid'), brief('c', 'refunded'), brief('d', 'kept')]), 597);
});

test('mandate: every purchase passes the gate in code', () => {
  const m = parseMandate({ maxCents: 400, minScore: 20 });
  assert.deepEqual(mayBuy(mk('a', 40), m, [], T0), { ok: true });
  assert.equal(mayBuy(mk('a', 5), m, [], T0).ok, false);
  assert.equal(mayBuy(null, m, [], T0).ok, false);
  const again = mayBuy(mk('a', 40), m, [brief('a')], T0);
  assert.equal(again.ok, false);
  assert.match(again.ok ? '' : again.reason, /already bought/);
  const broke = mayBuy(mk('z', 40), m, [brief('x'), brief('y', 'refunded')], T0);
  assert.equal(broke.ok, true);
  const full = mayBuy(mk('z', 40), m, [brief('x'), brief('y')], T0);
  assert.match(full.ok ? '' : full.reason, /budget left \$0\.02/);
});
