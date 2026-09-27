import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOARDS, boardById } from '../src/lib/boards';
import { normPrice } from '../src/lib/panta';

test('boards: every spec is a complete, resolvable market', () => {
  assert.ok(BOARDS.length >= 6);
  for (const b of BOARDS) {
    assert.match(b.question, /\?$/, `${b.id}: question must end with a question mark`);
    assert.ok(b.resolutionRule.length > 40, `${b.id}: resolution rule is too short to be a rule`);
    assert.ok(b.sourcesOfTruth.length >= 1, `${b.id}: needs a named source of truth`);
    assert.ok(b.resolutionTime >= b.endTime, `${b.id}: cannot resolve before trading ends`);
    assert.ok(Number.isFinite(b.endTime) && b.endTime > 1_700_000_000, `${b.id}: endTime must be a unix time`);
    assert.equal(b.via, 'board');
  }
});

test('boards: ids are unique and resolvable', () => {
  const ids = BOARDS.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.equal(boardById(id)?.id, id);
  assert.equal(boardById('nope'), null);
  assert.equal(boardById(null), null);
});

test('normPrice: accepts decimal strings and 1e9-scaled integers', () => {
  assert.equal(normPrice('0.43'), 0.43);
  assert.equal(normPrice(430000000), 0.43);
  assert.equal(normPrice(1), 1);
  assert.equal(normPrice(''), null);
  assert.equal(normPrice(null), null);
  assert.equal(normPrice('abc'), null);
});
