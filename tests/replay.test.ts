import { test } from 'node:test';
import assert from 'node:assert/strict';
import { walkForward } from '../src/lib/backtest';
import { market, print } from './helpers';

const yesRun = (n: number, price?: number) => Array.from({ length: n }, (_, i) => print('yes', 10, (i + 1) * 60, price === undefined ? {} : { price }));

test('walkForward: an empty tape never opens', () => {
  const r = walkForward(market(), []);
  assert.equal(r.opened, null);
  assert.equal(r.side, 'FLAT');
  assert.equal(r.tapeSize, 0);
});

test('walkForward: a one-sided tape opens on that side', () => {
  const r = walkForward(market(), yesRun(10, 0.6));
  assert.equal(r.side, 'YES');
  assert.ok(r.opened !== null && r.opened >= 1 && r.opened <= 10);
  assert.equal(r.yes, 0.6);
});

test('walkForward: no look-ahead, later prints cannot change the call', () => {
  const head = yesRun(10, 0.6);
  const base = walkForward(market(), head);
  assert.ok(base.opened !== null);
  // pile contrary prints on after the opening print: the call must be identical
  const later = Array.from({ length: 40 }, (_, i) => print('no', 1000, 10_000 + i * 60, { price: 0.05 }));
  const withFuture = walkForward(market(), [...head.slice(0, base.opened!), ...later]);
  assert.equal(withFuture.opened, base.opened);
  assert.equal(withFuture.side, base.side);
  assert.equal(withFuture.score, base.score);
  assert.equal(withFuture.yes, base.yes);
  assert.equal(withFuture.asOf, base.asOf);
});

test('walkForward: the order the tape arrives in does not matter', () => {
  const t = yesRun(10, 0.6);
  assert.deepEqual(walkForward(market(), [...t].reverse()), walkForward(market(), t));
});

test('walkForward: does not open inside the last ten minutes before close', () => {
  // the market closes 5 minutes after T0, so every print lands inside the last ten minutes or after the close
  const r = walkForward(market(300), yesRun(10, 0.6));
  assert.equal(r.opened, null);
});

test('walkForward: claims and prints without a time are not replayed', () => {
  const t = [...yesRun(3, 0.6), print('yes', 10, 500, { kind: 'claim' }), print('yes', 10, 600, { blockTime: null })];
  assert.equal(walkForward(market(), t).tapeSize, 3);
});

test('walkForward: without a logged price the entry price is an estimate between 0 and 1', () => {
  const r = walkForward(market(), yesRun(10));
  assert.ok(r.yes > 0.5 && r.yes < 1);
});
