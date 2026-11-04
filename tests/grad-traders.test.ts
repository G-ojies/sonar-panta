import { test } from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import { DISC, MUSDC, PM_AMM_PROGRAM, encodeSwap, u64le } from '../src/lib/grad-market';
import { summarize, tradeFromTx, TEAM_WALLETS, type ParsedTx, type TradeEvent } from '../src/lib/grad-traders';

const W = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const bal = (owner: string, amount: string) => ({ mint: MUSDC, owner, uiTokenAmount: { amount } });
const tx = (data: Uint8Array, pre: string, post: string, err: unknown = null): ParsedTx => ({
  blockTime: 100,
  meta: { err, preTokenBalances: [bal(W, pre)], postTokenBalances: [bal(W, post)] },
  transaction: { signatures: ['sig1'], message: { accountKeys: [{ pubkey: W, signer: true }], instructions: [{ programId: 'ComputeBudget111111111111111111111111111111', data: '3' }, { programId: PM_AMM_PROGRAM, data: bs58.encode(data) }] } },
});

test('a buy-YES swap is a trade by the fee payer with the mUSDC it spent', () => {
  const e = tradeFromTx(tx(encodeSwap('buyYes', 5_000_000n), '1000000000', '995000000'), 'B1');
  assert.deepEqual(e, { sig: 'sig1', wallet: W, binding: 'B1', kind: 'buyYes', volumeRaw: '5000000', blockTime: 100 });
});

test('a sell and a claim are read, a failed tx and other programs are not', () => {
  assert.equal(tradeFromTx(tx(encodeSwap('sellNo', 1n), '0', '2000000'), 'B')?.kind, 'sellNo');
  assert.equal(tradeFromTx(tx(new Uint8Array([...DISC.claimWinnings, ...u64le(0)]), '0', '7'), 'B')?.kind, 'claim');
  assert.equal(tradeFromTx(tx(encodeSwap('buyNo', 1n), '5', '4', { InstructionError: [0, 'x'] }), 'B'), null);
  assert.equal(tradeFromTx(tx(new Uint8Array([...DISC.halt]), '0', '0'), 'B'), null);
});

test('summary leaves out team wallets and ranks by trades then volume', () => {
  const team = [...TEAM_WALLETS][0];
  const ev = (wallet: string, kind: TradeEvent['kind'], vol: string, binding = 'B', t = 1): TradeEvent => ({ sig: `${wallet}${kind}${vol}${t}`, wallet, binding, kind, volumeRaw: vol, blockTime: t });
  const s = summarize([ev(team, 'buyYes', '999'), ev('A', 'buyYes', '10'), ev('A', 'sellYes', '5', 'C'), ev('B', 'buyNo', '50'), ev('B', 'claim', '60'), ev('C', 'buyNo', '50', 'B', 0)]);
  assert.equal(s.traders, 3);
  assert.equal(s.trades, 4);
  assert.equal(s.volumeRaw, '115');
  assert.deepEqual(s.rows.map((r) => r.wallet), ['A', 'B', 'C']);
  assert.equal(s.rows[0].markets, 2);
  assert.equal(s.rows[1].claims, 1);
});
