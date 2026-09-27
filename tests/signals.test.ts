import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSignals, momentumFrom, tapeStats } from '../src/lib/signals';
import type { VenueMatch } from '../src/lib/types';
import { T0, market, print } from './helpers';

const now = T0 + 3600;
const tape = (side: 'yes' | 'no', n: number) => Array.from({ length: n }, (_, i) => print(side, 10, i * 60));

test('tapeStats: flow is +1 on an all-YES tape and -1 on an all-NO tape', () => {
  assert.equal(tapeStats(tape('yes', 8), now).flow, 1);
  assert.equal(tapeStats(tape('no', 8), now).flow, -1);
});

test('tapeStats: balanced tape has zero flow, claims are ignored', () => {
  const t = [print('yes', 10, 0), print('no', 10, 60), print('yes', 500, 120, { kind: 'claim' })];
  const s = tapeStats(t, now);
  assert.equal(s.flow, 0);
  assert.equal(s.total, 20);
});

test('tapeStats: one wallet gives concentration 1', () => {
  const t = [0, 1, 2].map((i) => print('yes', 10, i * 60, { wallet: 'same' }));
  const s = tapeStats(t, now);
  assert.equal(s.wallets, 1);
  assert.equal(s.hhi, 1);
});

test('momentumFrom: compares against the oldest snapshot in the last 24h', () => {
  const snaps = [
    { marketId: 'mkt', ts: now - 30 * 3600, yesPrice: 0.1, volumeUsdc: 0, trades: 0 },
    { marketId: 'mkt', ts: now - 20 * 3600, yesPrice: 0.4, volumeUsdc: 0, trades: 0 },
    { marketId: 'mkt', ts: now - 3600, yesPrice: 0.45, volumeUsdc: 0, trades: 0 },
  ];
  assert.ok(Math.abs(momentumFrom(snaps, 0.5, now)! - 0.1) < 1e-9);
  assert.equal(momentumFrom(snaps, null, now), null);
  assert.equal(momentumFrom([], 0.5, now), null);
});

test('computeSignals: heavy YES flow reads YES, heavy NO flow reads NO, and the two mirror', () => {
  const y = computeSignals(market(), tape('yes', 8), [], 0.5, null, now);
  const n = computeSignals(market(), tape('no', 8), [], 0.5, null, now);
  assert.equal(y.side, 'YES');
  assert.equal(n.side, 'NO');
  assert.equal(y.score, -n.score);
  assert.ok(y.reasons.some((r) => r.startsWith('YES flow')));
});

test('computeSignals: an empty tape is FLAT and says so', () => {
  const s = computeSignals(market(), [], [], 0.5, null, now);
  assert.equal(s.side, 'FLAT');
  assert.equal(s.score, 0);
  assert.ok(s.reasons.includes('no prints on the tape yet'));
});

test('computeSignals: a market past its close never produces a call', () => {
  const s = computeSignals(market(-60), tape('yes', 12), [], 0.5, null, now);
  assert.equal(s.score, 0);
  assert.equal(s.side, 'FLAT');
});

test('computeSignals: score stays inside -100..100', () => {
  const venue = { venue: 'polymarket', yesPrice: 0.99 } as unknown as VenueMatch;
  const s = computeSignals(market(), tape('yes', 30), [], 0.01, venue, now);
  assert.ok(s.score <= 100 && s.score >= -100);
});

test('computeSignals: a richer price on another venue pushes toward YES and is named in the reasons', () => {
  const venue = { venue: 'polymarket', yesPrice: 0.8 } as unknown as VenueMatch;
  const balanced = [print('yes', 10, 0), print('no', 10, 60), print('yes', 10, 120), print('no', 10, 180)];
  const withVenue = computeSignals(market(), balanced, [], 0.4, venue, now);
  const without = computeSignals(market(), balanced, [], 0.4, null, now);
  assert.ok(Math.abs(withVenue.crossVenueGap! - 0.4) < 1e-9);
  assert.equal(without.crossVenueGap, null);
  assert.ok(withVenue.score > without.score);
  assert.equal(withVenue.side, 'YES');
  assert.ok(withVenue.reasons.some((r) => r.includes('polymarket')));
});

test('computeSignals: a tape dominated by one wallet is marked down', () => {
  const many = computeSignals(market(), tape('yes', 8), [], 0.5, null, now);
  const one = computeSignals(market(), tape('yes', 8).map((t) => ({ ...t, wallet: 'same' })), [], 0.5, null, now);
  assert.ok(one.score < many.score);
  assert.ok(one.reasons.some((r) => r.includes('dominated by 1 wallet')));
});

test('computeSignals: high confidence needs at least five prints', () => {
  const s = computeSignals(market(), tape('yes', 4), [], 0.5, null, now);
  assert.notEqual(s.confidence, 'high');
});
