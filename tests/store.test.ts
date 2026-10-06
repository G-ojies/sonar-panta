import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pack, unpack } from '../src/lib/store';

test('large values travel gzipped and read back unchanged', () => {
  const big = { markets: Array.from({ length: 400 }, (_, i) => ({ id: `m${i}`, title: 'Will it rain in Benin City tomorrow?', yes: i / 400 })) };
  const p = pack(big);
  assert.equal(typeof p, 'string');
  assert.ok((p as string).startsWith('gz:'));
  assert.ok((p as string).length < JSON.stringify(big).length / 3);
  assert.deepEqual(unpack(p), big);
});

test('small values and values stored before compression pass through', () => {
  assert.deepEqual(pack({ a: 1 }), { a: 1 });
  assert.deepEqual(unpack({ a: 1 }), { a: 1 });
  assert.equal(unpack('plain string'), 'plain string');
  assert.equal(unpack(null), null);
});
