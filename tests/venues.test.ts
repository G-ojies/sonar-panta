import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entityTokens, similarity, stem } from '../src/lib/venues';

test('stem: inflections compare equal', () => {
  assert.equal(stem('released'), stem('releases'));
  assert.equal(stem('launching'), stem('launched'));
  assert.equal(stem('btc'), 'btc');
});

test('similarity: the same question scores high', () => {
  const q = 'Will Bitcoin close above $150,000 on 31 December 2026?';
  assert.ok(similarity(q, q) > 0.9);
});

test('similarity: regression, different subjects sharing a verb and a date do not match', () => {
  const a = 'Will GTA 6 be released before November 2026?';
  const b = 'Will Google release Gemini 3 before November 2026?';
  assert.equal(similarity(a, b), 0);
});

test('similarity: same subject, different wording still matches above the Polymarket threshold', () => {
  const a = 'Will GTA 6 be released before November 2026?';
  const b = 'GTA 6 released before November 2026?';
  assert.ok(similarity(a, b) >= 0.55);
});

test('entityTokens: keeps names and tickers, drops filler and dates', () => {
  const e = entityTokens('Will BTC reach $150,000 by December 2026?');
  assert.ok(e.includes('btc'));
  assert.ok(!e.includes('december'));
  assert.ok(!e.includes('will'));
});
