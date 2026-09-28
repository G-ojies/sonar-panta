import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSettled, shouldSnapshot } from '../src/lib/radar';
import type { RadarMarket, Snapshot } from '../src/lib/types';

const row = (phase: string, settled?: boolean) => ({ detail: { marketId: 'm1', phase }, settled } as unknown as RadarMarket);

test('radar: only a resolved market with a complete tape is carried over', () => {
  assert.equal(isSettled(row('resolved', true)), true);
  assert.equal(isSettled(row('resolved')), false, 'tape not complete yet: keep fetching');
  assert.equal(isSettled(row('primary', true)), false, 'an open market is never final');
  assert.equal(isSettled(undefined), false);
});

test('radar: a snapshot is kept when something moved, or once an hour', () => {
  const last: Snapshot = { marketId: 'm1', ts: 1000, yesPrice: 0.5, volumeUsdc: 100, trades: 4 };
  assert.equal(shouldSnapshot(undefined, 1000, 0.5, 100, 4), true, 'the first one');
  assert.equal(shouldSnapshot(last, 1000 + 900, 0.5, 100, 4), false, 'nothing moved');
  assert.equal(shouldSnapshot(last, 1000 + 900, 0.52, 100, 4), true, 'price moved');
  assert.equal(shouldSnapshot(last, 1000 + 900, 0.5, 120, 4), true, 'volume moved');
  assert.equal(shouldSnapshot(last, 1000 + 900, 0.5, 100, 5), true, 'a trade printed');
  assert.equal(shouldSnapshot(last, 1000 + 300, 0.9, 500, 9), false, 'never more than one in ten minutes');
  assert.equal(shouldSnapshot(last, 1000 + 3600, 0.5, 100, 4), true, 'hourly, so the chart has a point');
});
