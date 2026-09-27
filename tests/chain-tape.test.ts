import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeTapes, parseOrderLog, tapeIsShort, tradesFromTx } from '../src/lib/chain-tape';
import { print } from './helpers';

const USDC_LINE = 'Program log: Primary Order (USDC): side=No, amount=1727203, yes_price=499344245, no_price=500655755, minted=3440032';
const SOL_LINE = 'Program log: Primary Order: side=Yes, lamports=245272000, yes_price=549137856, no_price=450862144, minted=439326839';

const tx = (logs: string[], err: unknown = null) => ({
  blockTime: 1_790_000_000, meta: { err, logMessages: logs }, transaction: { message: { accountKeys: ['WALLET', 'OTHER'] } },
});

test('parseOrderLog: USDC order', () => {
  assert.deepEqual(parseOrderLog(USDC_LINE), { quote: 'USDC', side: 'no', amountRaw: 1727203, yesPrice: 0.499344245, shares: 3.440032 });
});

test('parseOrderLog: older SOL order', () => {
  assert.deepEqual(parseOrderLog(SOL_LINE), { quote: 'SOL', side: 'yes', amountRaw: 245272000, yesPrice: 0.549137856, shares: 439.326839 });
});

test('parseOrderLog: other log lines are ignored', () => {
  assert.equal(parseOrderLog('Program log: Instruction: Transfer'), null);
  assert.equal(parseOrderLog('Program log: Primary Order (USDC): side=Maybe, amount=1'), null);
  assert.equal(parseOrderLog(''), null);
});

test('tradesFromTx: one print per order line, signer is the wallet, price is carried', () => {
  const out = tradesFromTx('mkt', 'SIG', tx(['Program log: Instruction: Buy', USDC_LINE]));
  assert.equal(out.length, 1);
  assert.equal(out[0].wallet, 'WALLET');
  assert.equal(out[0].side, 'no');
  assert.equal(out[0].price, 0.499344245);
  assert.equal(out[0].amountUsdc, '1.727203');
  assert.equal(out[0].source, 'chain');
  assert.equal(out[0].yesAmount, 0);
  assert.equal(out[0].noAmount, 1727203);
});

test('tradesFromTx: two orders in one transaction get distinct ids', () => {
  const out = tradesFromTx('mkt', 'SIG', tx([USDC_LINE, SOL_LINE]));
  assert.deepEqual(out.map((t) => t.id), ['SIG', 'SIG:1']);
  assert.equal(out[1].amountUsdc, null);
});

test('tradesFromTx: failed or log-less transactions produce nothing', () => {
  assert.deepEqual(tradesFromTx('mkt', 'SIG', tx([USDC_LINE], { InstructionError: [0, 'Custom'] })), []);
  assert.deepEqual(tradesFromTx('mkt', 'SIG', { blockTime: 1, meta: null, transaction: { message: { accountKeys: ['W'] } } }), []);
});

test('mergeTapes: a print present in both tapes is kept once, the API row wins, newest first', () => {
  const api = [print('yes', 5, 100, { signature: 'A' })];
  const chain = [print('yes', 5, 100, { signature: 'A', source: 'chain' }), print('no', 7, 200, { signature: 'B', source: 'chain' })];
  const out = mergeTapes(api, chain);
  assert.deepEqual(out.map((t) => t.signature), ['B', 'A']);
  assert.equal(out[1].source, 'api');
  assert.equal(out[0].source, 'chain');
});

test('tapeIsShort: true only when the chain counts more buys than the API returned', () => {
  const api = [print('yes', 1, 0), print('no', 1, 1), print('yes', 1, 2, { kind: 'claim' })];
  assert.equal(tapeIsShort(api, 5), true);
  assert.equal(tapeIsShort(api, 2), false);
  assert.equal(tapeIsShort(api, undefined), false);
  assert.equal(tapeIsShort(api, 'not a number'), false);
});
