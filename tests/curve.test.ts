import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activationTime, mergePrints, poolFields, prune, rankPools, spread, tapeCandidates, tapeFields, type CurvePool, type CurveTape } from '../src/lib/curve';
import type { CurvePrint, VirtualPoolState } from '../src/lib/dbc';

const T0 = 1_790_000_000;

let seq = 0;
function print(side: 'buy' | 'sell', quoteSol: number, at: number, extra: Partial<CurvePrint> = {}): CurvePrint {
  seq += 1;
  return {
    id: `s${seq}`, signature: `s${seq}`, blockTime: T0 + at, pool: 'POOL', wallet: `w${seq}`, side, quoteRaw: String(Math.round(quoteSol * 1e9)), baseRaw: '1000000000',
    tradingFeeRaw: '0', sqrtPriceAfter: '18446744073709551616', quoteReserveAfter: '0', migrationThreshold: '85000000000', source: 'chain', ...extra,
  };
}

function pool(address: string, over: Partial<CurvePool> = {}): CurvePool {
  return {
    address, config: 'CFG', creator: 'C', baseMint: 'M', quote: { mint: 'So11111111111111111111111111111111111111112', symbol: 'SOL', decimals: 9 }, baseDecimals: 6,
    createdAt: null, createdFrom: null, firstSeenAt: T0, lastSeenAt: T0, foundBy: 'swap', status: 'trading', price: 1e-7, sqrtPrice: '1', quoteRaised: 10, quoteReserveRaw: '10000000000',
    threshold: 85, thresholdRaw: '85000000000', progressPct: 11.76, finishCurveAt: null, prints: 0, buys: 0, sells: 0, buyQuote: 0, largest: [], tape: [], updatedAt: T0, ...over,
  };
}

test('mergePrints: once each, newest first, capped at 200, same object back when nothing is new', () => {
  const a = print('buy', 1, 10), b = print('sell', 2, 20);
  const t1 = mergePrints(null, [a]);
  assert.deepEqual(t1.prints.map((p) => p.id), [a.id]);
  const t2 = mergePrints(t1, [a, b]);
  assert.deepEqual(t2.prints.map((p) => p.id), [b.id, a.id]);
  assert.equal(mergePrints(t2, [a]), t2);
  const many = Array.from({ length: 250 }, (_, i) => print('buy', 1, i));
  assert.equal(mergePrints(null, many).prints.length, 200);
  assert.equal(mergePrints(null, many).prints[0].blockTime, T0 + 249);
});

test('tapeFields: counts, bought quote, the three largest, the last five', () => {
  const prints = [print('buy', 5, 50), print('sell', 9, 40), print('buy', 1, 30), print('buy', 7, 20), print('sell', 0.5, 10), print('buy', 0.1, 5)];
  const f = tapeFields(prints, 9);
  assert.equal(f.prints, 6);
  assert.equal(f.buys, 4);
  assert.equal(f.sells, 2);
  assert.ok(Math.abs(f.buyQuote - 13.1) < 1e-9);
  assert.deepEqual(f.largest.map((l) => l.quote), [9, 7, 5]);
  assert.equal(f.largest[0].side, 'sell');
  assert.equal(f.tape.length, 5);
  assert.equal(f.tape[0].blockTime, T0 + 50);
});

test('poolFields: price, raised, threshold, progress and status from a decoded account', () => {
  const state = { quote_reserve: 42_500_000_000n, sqrt_price: 1n << 64n, is_migrated: 0, finish_curve_timestamp: 0n } as unknown as VirtualPoolState;
  const cfg = { quote: { mint: 'x', symbol: 'SOL', decimals: 9 }, baseDecimals: 6, thresholdRaw: '85000000000', migrationSqrtPrice: '0', sqrtStartPrice: '0', activationType: 0, totalSupplyRaw: '0' };
  const f = poolFields(state, cfg, T0);
  assert.equal(f.status, 'trading');
  assert.equal(f.price, 1e-3);
  assert.equal(f.quoteRaised, 42.5);
  assert.equal(f.threshold, 85);
  assert.equal(f.progressPct, 50);
  assert.equal(f.finishCurveAt, null);
  const done = poolFields({ ...state, finish_curve_timestamp: 1_790_000_100n } as VirtualPoolState, cfg, T0);
  assert.equal(done.status, 'complete');
  assert.equal(done.finishCurveAt, 1_790_000_100);
});

test('activationTime: exact for a timestamp config, estimated at 0.4 s a slot for a slot config, null when unknowable', () => {
  assert.deepEqual(activationTime({ activation_point: 1_790_000_000n }, { activationType: 1 }, null, T0 + 500), { at: 1_790_000_000, from: 'activation' });
  assert.deepEqual(activationTime({ activation_point: 1000n }, { activationType: 0 }, 2500, T0), { at: T0 - 600, from: 'slot' });
  assert.equal(activationTime({ activation_point: 1000n }, { activationType: 0 }, null, T0), null);
  assert.equal(activationTime({ activation_point: 0n }, { activationType: 1 }, 1, T0), null);
  assert.equal(activationTime({ activation_point: 3000n }, { activationType: 0 }, 2500, T0), null); // activates in the future
});

test('spread: n rows evenly across the list, the whole list when it is short', () => {
  const rows = Array.from({ length: 100 }, (_, i) => i);
  assert.deepEqual(spread(rows, 4), [0, 25, 50, 75]);
  assert.deepEqual(spread(rows, 30).length, 30);
  assert.deepEqual(spread([1, 2, 3], 10), [1, 2, 3]);
  assert.deepEqual(spread([], 5), []);
});

test('prune: pinned stay, quiet pools go, long-migrated pools go, the most recently active fill the cap', () => {
  const now = T0 + 48 * 3600;
  const pools = {
    fresh: pool('fresh', { lastSeenAt: now - 60 }),
    quiet: pool('quiet', { lastSeenAt: now - 40 * 3600 }),
    pinnedQuiet: pool('pinnedQuiet', { lastSeenAt: now - 400 * 3600 }),
    oldMigrated: pool('oldMigrated', { status: 'migrated', lastSeenAt: now - 30 * 3600, updatedAt: now - 30 * 3600 }),
    newMigrated: pool('newMigrated', { status: 'migrated', lastSeenAt: now - 3600, updatedAt: now - 60 }),
    older: pool('older', { lastSeenAt: now - 7200 }),
  };
  const kept = prune(pools, new Set(['pinnedQuiet']), now, 3, 36);
  assert.deepEqual(Object.keys(kept), ['pinnedQuiet', 'fresh', 'newMigrated']);
  const all = prune(pools, new Set(['pinnedQuiet']), now, 100, 36);
  assert.deepEqual(Object.keys(all).sort(), ['fresh', 'newMigrated', 'older', 'pinnedQuiet']);
});

test('tapeCandidates: pinned first, then trading pools nearest graduation, migrated last', () => {
  const pools = [
    pool('migrated', { status: 'migrated', progressPct: 100 }),
    pool('low', { progressPct: 5 }),
    pool('high', { progressPct: 90 }),
    pool('pinned', { progressPct: 1 }),
    pool('mid', { progressPct: 50 }),
  ];
  const ages = new Map([['low', 10 * 3600]]);
  assert.deepEqual(tapeCandidates(pools, new Set(['pinned']), ages, 3).map((p) => p.address), ['pinned', 'high', 'mid']);
  assert.deepEqual(tapeCandidates(pools, new Set(), new Map(), 5).map((p) => p.address).at(-1), 'migrated');
});

test('rankPools: trading nearest graduation first, then complete, then migrated, ties by last activity', () => {
  const rows = [
    pool('m', { status: 'migrated', progressPct: 100, lastSeenAt: T0 + 100 }),
    pool('c', { status: 'complete', progressPct: 100 }),
    pool('t1', { progressPct: 20, lastSeenAt: T0 + 5 }),
    pool('t2', { progressPct: 80 }),
    pool('t3', { progressPct: 20, lastSeenAt: T0 + 50 }),
  ];
  assert.deepEqual(rankPools(rows).map((p) => p.address), ['t2', 't3', 't1', 'c', 'm']);
});

test('CurveTape shape round-trips through mergePrints with cursor and completeness untouched', () => {
  const t: CurveTape = { ts: 5, cursor: 'abc', prints: [], complete: true };
  const out = mergePrints(t, [print('buy', 1, 1)]);
  assert.equal(out.cursor, 'abc');
  assert.equal(out.complete, true);
  assert.equal(out.ts, 5);
});
