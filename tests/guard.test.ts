import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, toMarkdown, type GuardSnapshot } from '../src/lib/guard';

const NOW = 1_791_000_000_000;
const good = (over: Partial<GuardSnapshot> = {}): GuardSnapshot => ({
  at: NOW,
  // the live refresh log reports unix seconds
  health: { ok: true, store: 'redis', radarUpdatedAt: (NOW - 10 * 60_000) / 1000, radarMarkets: 120, commit: 'abc1234def' },
  agent: { backtest: { markets: 136, calls: 76, hits: 45 } },
  status: { health: '200', agent: '200' },
  ...over,
});
const failed = (r: ReturnType<typeof evaluate>) => r.checks.filter((c) => !c.ok).map((c) => c.id);

test('guard: a healthy deploy passes and carries the record forward', () => {
  const r = evaluate(good(), 'https://x', 'abc1234', null);
  assert.equal(r.ok, true, JSON.stringify(r.checks));
  assert.deepEqual(r.record, { markets: 136, calls: 76, hits: 45, radarMarkets: 120 });
});

test('guard: the wrong commit live means the deploy did not land', () => {
  assert.deepEqual(failed(evaluate(good(), 'https://x', 'fff0000', null)), ['commit']);
});

test('guard: a stale radar or the memory store fails (the 6 Oct outage looked like this)', () => {
  const s = good({ health: { ok: true, store: 'memory', radarUpdatedAt: NOW - 3 * 3600_000, radarMarkets: 0, commit: null } });
  assert.deepEqual(failed(evaluate(s, 'https://x', null, null)), ['store', 'radar-fresh', 'radar-size']);
});

test('guard: a radar time in milliseconds is read the same as seconds', () => {
  const s = good({ health: { ok: true, store: 'redis', radarUpdatedAt: NOW - 10 * 60_000, radarMarkets: 120, commit: null } });
  assert.match(evaluate(s, 'https://x', null, null).checks.find((c) => c.id === 'radar-fresh')!.detail, /^radar updated 10 min ago/);
});

test('guard: the walk-forward record may grow but not shrink past the limit', () => {
  const prev = evaluate(good(), 'https://x', null, null);
  assert.equal(evaluate(good({ agent: { backtest: { markets: 140, calls: 78, hits: 46 } } }), 'https://x', null, prev).ok, true);
  assert.equal(evaluate(good({ agent: { backtest: { markets: 130, calls: 70, hits: 40 } } }), 'https://x', null, prev).ok, true);
  assert.deepEqual(failed(evaluate(good({ agent: { backtest: { markets: 60, calls: 30, hits: 20 } } }), 'https://x', null, prev)), ['record-kept']);
});

test('guard: an unreachable site fails every check and keeps the last record', () => {
  const prev = evaluate(good(), 'https://x', null, null);
  const down: GuardSnapshot = { at: NOW, health: null, agent: null, status: { health: 'error: fetch failed', agent: 'error: fetch failed' } };
  const r = evaluate(down, 'https://x', null, prev);
  assert.equal(r.ok, false);
  assert.deepEqual(r.record, prev.record);
  assert.match(toMarkdown(r), /\*\*FAIL\*\* \| health/);
});
