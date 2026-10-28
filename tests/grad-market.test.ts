import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'crypto';
import { PublicKey } from '@solana/web3.js';
import pmIdl from '../onchain/pm-amm-idl.json';
import {
  BINDING, BINDING_SIZE, DISC, PM_MARKET, crankPlan, decodeBinding, decodePmMarket, deriveMarket, dueStep, encodeOpenMarket, encodeSwap,
  fixedToNumber, normCdf, phaseOf, swapPlan, yesPrice, type GradBinding, type PmMarketState,
} from '../src/lib/grad-market';

const sha8 = (s: string) => [...createHash('sha256').update(s).digest().subarray(0, 8)];

// ---- layouts against the IDLs ----

test('discriminators are the Anchor hashes and pm-AMM IDL values', () => {
  assert.deepEqual([...DISC.binding], sha8('account:Binding'));
  assert.deepEqual([...DISC.openMarket], sha8('global:open_market'));
  const ix = (n: string) => (pmIdl.instructions.find((i) => i.name === n) as { discriminator: number[] }).discriminator;
  assert.deepEqual([...DISC.swap], ix('swap'));
  assert.deepEqual([...DISC.claimWinnings], ix('claim_winnings'));
});

test('pm-AMM Market offsets follow its IDL', () => {
  const size = (t: unknown): number => {
    if (t === 'pubkey') return 32;
    if (t === 'u128' || t === 'i128') return 16;
    if (t === 'u64' || t === 'i64') return 8;
    if (t === 'u16') return 2;
    if (t === 'u8' || t === 'bool') return 1;
    const a = (t as { array: [unknown, number] }).array;
    return size(a[0]) * a[1];
  };
  const fields = (pmIdl.types.find((t) => t.name === 'Market') as { type: { fields: { name: string; type: unknown }[] } }).type.fields;
  const offsets: Record<string, number> = {};
  let o = 8;
  for (const f of fields) { offsets[f.name] = o; o += size(f.type); }
  const names: Record<keyof typeof PM_MARKET, string> = {
    authority: 'authority', marketId: 'market_id', collateralMint: 'collateral_mint', yesMint: 'yes_mint', noMint: 'no_mint', vault: 'vault',
    startTs: 'start_ts', endTs: 'end_ts', lZero: 'l_zero', reserveYes: 'reserve_yes', reserveNo: 'reserve_no', lastAccrualTs: 'last_accrual_ts',
    resolved: 'resolved', winningSide: 'winning_side',
  };
  for (const [k, n] of Object.entries(names)) assert.equal(PM_MARKET[k as keyof typeof PM_MARKET], offsets[n], k);
});

test('Binding layout matches the Rust struct order', () => {
  assert.equal(BINDING_SIZE, 205);
  assert.deepEqual(Object.values(BINDING), [8, 40, 72, 104, 136, 168, 176, 184, 192, 200, 201, 202]);
});

// ---- decoding ----

function bindingBytes(over: Partial<{ halted: boolean; resolved: boolean; deadline: number }> = {}) {
  const b = Buffer.alloc(BINDING_SIZE);
  Buffer.from(DISC.binding).copy(b, 0);
  for (let i = 0; i < 5; i++) new PublicKey(new Uint8Array(32).fill(i + 1)).toBuffer().copy(b, 8 + 32 * i);
  b.writeBigInt64LE(BigInt(over.deadline ?? 1_800_000_000), BINDING.deadline);
  b.writeBigUInt64LE(85_000_000_000n, BINDING.threshold);
  b.writeBigUInt64LE(100_000_000n, BINDING.seed);
  b[BINDING.halted] = over.halted ? 1 : 0;
  b[BINDING.resolved] = over.resolved ? 1 : 0;
  return b;
}

test('decodeBinding reads every field and refuses other accounts', () => {
  const b = decodeBinding(bindingBytes({ halted: true }), 'X');
  assert.equal(b.pool, new PublicKey(new Uint8Array(32).fill(1)).toBase58());
  assert.equal(b.collateralMint, new PublicKey(new Uint8Array(32).fill(5)).toBase58());
  assert.equal(b.deadlineTs, 1_800_000_000);
  assert.equal(b.thresholdRaw, '85000000000');
  assert.equal(b.seedRaw, '100000000');
  assert.equal(b.halted, true);
  assert.equal(b.resolved, false);
  const bad = bindingBytes(); bad[0] ^= 1;
  assert.throws(() => decodeBinding(bad));
  assert.throws(() => decodeBinding(bindingBytes().subarray(0, 100)));
});

const FX = 2n ** 48n;
function pmBytes(o: { l0: number; x: number; y: number; end: number; last: number; resolved?: boolean; side?: number }) {
  const b = Buffer.alloc(420);
  const u128 = (v: bigint, at: number) => { b.writeBigUInt64LE(v & ((1n << 64n) - 1n), at); b.writeBigUInt64LE(v >> 64n, at + 8); };
  b.writeBigInt64LE(BigInt(o.end), PM_MARKET.endTs);
  b.writeBigInt64LE(BigInt(o.last), PM_MARKET.lastAccrualTs);
  u128(BigInt(Math.round(o.l0)) * FX, PM_MARKET.lZero);
  u128(BigInt(Math.round(o.x)) * FX, PM_MARKET.reserveYes);
  u128(BigInt(Math.round(o.y)) * FX, PM_MARKET.reserveNo);
  b[PM_MARKET.resolved] = o.resolved ? 1 : 0;
  b[PM_MARKET.winningSide] = o.side ?? 0;
  return b;
}

// ---- pricing ----

test('fixedToNumber keeps the fraction and normCdf is the normal CDF', () => {
  assert.equal(fixedToNumber((3n * FX) + FX / 4n), 3.25);
  assert.ok(Math.abs(normCdf(0) - 0.5) < 1e-9);
  assert.ok(Math.abs(normCdf(1.96) - 0.975) < 1e-3);
  assert.ok(Math.abs(normCdf(-1) + normCdf(1) - 1) < 1e-9);
});

test('yesPrice: even reserves are 50c, more NO reserve means a dearer YES, halted and resolved', () => {
  const even = decodePmMarket(pmBytes({ l0: 1000, x: 5000, y: 5000, end: 10_000, last: 0 }));
  assert.ok(Math.abs(yesPrice(even)! - 0.5) < 1e-9);
  // Buying YES takes YES out of the pool and adds NO: y > x raises the YES price.
  const bid = decodePmMarket(pmBytes({ l0: 1000, x: 4000, y: 9000, end: 10_000, last: 0 }));
  assert.ok(yesPrice(bid)! > 0.5);
  assert.equal(yesPrice(decodePmMarket(pmBytes({ l0: 0, x: 0, y: 0, end: 10_000, last: 0 }))), null);
  assert.equal(yesPrice(decodePmMarket(pmBytes({ l0: 1000, x: 1, y: 1, end: 10, last: 0, resolved: true, side: 1 }))), 1);
  assert.equal(yesPrice(decodePmMarket(pmBytes({ l0: 1000, x: 1, y: 1, end: 10, last: 0, resolved: true, side: 2 }))), 0);
});

test('phaseOf orders resolved, halted, expired and trading', () => {
  const b = decodeBinding(bindingBytes({ deadline: 1000 }));
  const open = { resolved: false, winningSide: 0 } as PmMarketState;
  assert.equal(phaseOf(b, open, 999), 'trading');
  assert.equal(phaseOf(b, open, 1000), 'expired');
  assert.equal(phaseOf({ ...b, halted: true } as GradBinding, open, 10), 'halted');
  assert.equal(phaseOf(b, { resolved: true, winningSide: 2 } as PmMarketState, 10), 'resolved-no');
});

// ---- addresses and instructions ----

test('deriveMarket gives the live devnet market for its binding', () => {
  // The first market, opened on 28 October 2026 by scripts/grad-market-devnet.ts.
  const d = deriveMarket('Bk47WNJxxoXJWtbnNSjhRpNprrFUTAtfbqKSK1qJa7Vi');
  assert.equal(d.pmMarket.toBase58(), 'FwBiXLzAsfPBoqRGMMk97tVpUPGYgURkfnnNRc2butCw');
});

test('instruction data is discriminator then Borsh args', () => {
  const open = Buffer.from(encodeOpenMarket(1_800_000_000, 5000, 100_000_000n, 'Q?'));
  assert.deepEqual([...open.subarray(0, 8)], [...DISC.openMarket]);
  assert.equal(open.readBigInt64LE(8), 1_800_000_000n);
  assert.equal(open.readUInt16LE(16), 5000);
  assert.equal(open.readBigUInt64LE(18), 100_000_000n);
  assert.equal(open.readUInt32LE(26), 2);
  assert.equal(open.subarray(30).toString(), 'Q?');
  const swap = Buffer.from(encodeSwap('sellNo', 7n));
  assert.equal(swap.length, 8 + 1 + 8 + 8);
  assert.equal(swap[8], 3);
  assert.equal(swap.readBigUInt64LE(9), 7n);
});

test('swapPlan follows the pm-AMM swap account order', () => {
  const user = new PublicKey(new Uint8Array(32).fill(9));
  const m = { yesMint: new PublicKey(new Uint8Array(32).fill(2)).toBase58(), noMint: new PublicKey(new Uint8Array(32).fill(3)).toBase58(), vault: new PublicKey(new Uint8Array(32).fill(4)).toBase58() };
  const ixs = swapPlan(user, 'Bk47WNJxxoXJWtbnNSjhRpNprrFUTAtfbqKSK1qJa7Vi', m, 'buyYes', 1n);
  const swap = ixs.at(-1)!;
  const names = (pmIdl.instructions.find((i) => i.name === 'swap') as { accounts: { name: string }[] }).accounts.map((a) => a.name);
  assert.equal(swap.keys.length, names.length);
  assert.equal(swap.keys[0].pubkey.toBase58(), user.toBase58());
  assert.ok(swap.keys[0].isSigner);
  assert.equal(swap.keys[1].pubkey.toBase58(), 'FwBiXLzAsfPBoqRGMMk97tVpUPGYgURkfnnNRc2butCw');
  assert.equal(swap.keys[3].pubkey.toBase58(), m.yesMint);
  assert.equal(swap.keys[5].pubkey.toBase58(), m.vault);
});

// ---- the permissionless steps ----

test('crank discriminators are the Anchor instruction hashes', () => {
  assert.deepEqual([...DISC.halt], sha8('global:halt'));
  assert.deepEqual([...DISC.resolve], sha8('global:resolve'));
  assert.deepEqual([...DISC.settle], sha8('global:settle'));
});

test('phaseOf reports a known outcome before anyone halts', () => {
  const b = decodeBinding(bindingBytes({ deadline: 1000 }));
  const open = { resolved: false, winningSide: 0 } as PmMarketState;
  assert.equal(phaseOf(b, open, 10, true), 'known');
  assert.equal(phaseOf({ ...b, halted: true } as GradBinding, open, 10, true), 'halted');
  assert.equal(phaseOf(b, open, 1000, true), 'expired');
});

test('dueStep walks halt, resolve, settle like the keeper', () => {
  const b = decodeBinding(bindingBytes({ deadline: 1000 }));
  assert.equal(dueStep(b, 10, false), null, 'open question, nothing to do');
  assert.equal(dueStep(b, 10, true), 'halt', 'curve finished early');
  assert.equal(dueStep(b, 1000, false), null, 'at the deadline the curve may still finish in time');
  assert.equal(dueStep(b, 1001, false), 'halt', 'deadline passed');
  const halted = { ...b, halted: true } as GradBinding;
  assert.equal(dueStep(halted, 999, true), null, 'pm-AMM only resolves at end_ts');
  assert.equal(dueStep(halted, 1000, true), 'resolve');
  assert.equal(dueStep({ ...halted, resolved: true } as GradBinding, 2000, true), 'settle');
  assert.equal(dueStep({ ...halted, resolved: true, settled: true } as GradBinding, 2000, true), null);
});

test('crankPlan account counts follow the Rust Accounts structs', () => {
  const b = decodeBinding(bindingBytes(), 'Bk47WNJxxoXJWtbnNSjhRpNprrFUTAtfbqKSK1qJa7Vi');
  const m = { yesMint: b.pool, noMint: b.config, vault: b.opener };
  const caller = new PublicKey(new Uint8Array(32).fill(9));
  const count = (s: 'halt' | 'resolve' | 'settle') => crankPlan(s, caller, b, m).at(-1)!.keys.length;
  assert.deepEqual([count('halt'), count('resolve'), count('settle')], [15, 6, 13]);
  const halt = crankPlan('halt', caller, b, m).at(-1)!;
  assert.ok(halt.keys[0].isSigner && halt.keys[0].pubkey.equals(caller));
  assert.equal(halt.keys[1].pubkey.toBase58(), b.address);
  const d = deriveMarket(b.address);
  assert.equal(crankPlan('settle', caller, b, m).at(-1)!.keys[1].pubkey.toBase58(), d.authority.toBase58());
});
