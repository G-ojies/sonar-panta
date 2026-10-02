import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import idl from '../onchain/idl/curve_market.json';
import {
  ASSOCIATED_TOKEN_PROGRAM, CURVE_MARKET_PROGRAM, DISC, MARKET_POOL_OFFSET, MARKET_SIZE, NATIVE_MINT, POSITION_MARKET_OFFSET, POSITION_OWNER_OFFSET, POSITION_SIZE, TOKEN_PROGRAM,
  associatedTokenAddress, claimIx, claimPlan, createMarketIx, decodeMarket, decodePosition, encodeClaim, encodeCreateMarket, encodeResolve, encodeStake,
  fetchMarkets, fetchPositions, friendlyProgramError, marketPda, positionPda, rankMarkets, resolveIx, stakeIx, stakePlan, tokenAccountAmount, vaultPda,
} from '../src/lib/curve-market';
import { decide, impliedOdds, payoutFor, positionPayout, resolvedState, sideMultiple } from '../src/lib/curve-market-math';

// ---- fixtures ----

const POOL = 'HC7QTaRzfQuRDV8irdojM23WDQPaSmruSEnRmjkuqPuf';   // a devnet VirtualPool
const CONFIG = 'FAGvfZpCHPmNBSqzUP9EKtQqTsAA3VHRLLuqZuhv1Cu4';
const USER = 'FHj8w7MuuqMBeEKdFT2BXEEx9Xj6dZ18Z9cLiBmPr513';
const OTHER = 'Gj1j6jzSfZTugBndhsdy7rqWYXWhM3n3ix1DTkTACwDT';
const DEADLINE = 1_791_000_000;

const u8 = (n: number) => Buffer.from([n]);
const u64 = (n: bigint | number) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const i64 = (n: bigint | number) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
const key = (s: string) => Buffer.from(bs58.decode(s));

type IdlIx = { name: string; discriminator: number[] };
const ixDisc = (name: string) => Buffer.from((idl.instructions as IdlIx[]).find((i) => i.name === name)!.discriminator);
const accDisc = (name: string) => Buffer.from((idl.accounts as IdlIx[]).find((a) => a.name === name)!.discriminator);

/** A Market account laid out as the IDL's Market struct, discriminator first. */
function marketBytes(o: { yes?: bigint; no?: bigint; paid?: bigint; state?: number; resolvedAt?: number; vault?: string } = {}) {
  const [market, bump] = marketPda(POOL, DEADLINE);
  const [vault, vaultBump] = vaultPda(market);
  return Buffer.concat([
    accDisc('Market'), key(POOL), key(CONFIG), key(NATIVE_MINT), key(TOKEN_PROGRAM), key(o.vault ?? vault.toBase58()), key(USER),
    i64(DEADLINE), u64(10_000_000_000n), u64(o.yes ?? 0n), u64(o.no ?? 0n), u64(o.paid ?? 0n), u8(o.state ?? 0), i64(o.resolvedAt ?? 0), u8(bump), u8(vaultBump),
  ]);
}
function positionBytes(o: { yes?: bigint; no?: bigint; claimed?: boolean; owner?: string } = {}) {
  const [market] = marketPda(POOL, DEADLINE);
  const [, bump] = positionPda(market, o.owner ?? USER);
  return Buffer.concat([accDisc('Position'), market.toBuffer(), key(o.owner ?? USER), u64(o.yes ?? 0n), u64(o.no ?? 0n), u8(o.claimed ? 1 : 0), u8(bump)]);
}

// ---- constants against the IDL ----

test('discriminators and program id match the IDL', () => {
  assert.equal(CURVE_MARKET_PROGRAM, idl.address);
  assert.deepEqual([...DISC.createMarket], [...ixDisc('create_market')]);
  assert.deepEqual([...DISC.stake], [...ixDisc('stake')]);
  assert.deepEqual([...DISC.resolve], [...ixDisc('resolve')]);
  assert.deepEqual([...DISC.claim], [...ixDisc('claim')]);
  assert.deepEqual([...DISC.market], [...accDisc('Market')]);
  assert.deepEqual([...DISC.position], [...accDisc('Position')]);
});

test('account sizes follow from the IDL field layouts', () => {
  const size = (t: string) => ({ pubkey: 32, i64: 8, u64: 8, u8: 1, bool: 1 } as Record<string, number>)[t] ?? 1; // enums are one byte
  const typeSize = (name: string) => 8 + (idl.types.find((t) => t.name === name)!.type as { fields: { type: unknown }[] }).fields.reduce((n, f) => n + size(typeof f.type === 'string' ? f.type : 'enum'), 0);
  assert.equal(typeSize('Market'), MARKET_SIZE);
  assert.equal(typeSize('Position'), POSITION_SIZE);
  assert.equal(marketBytes().length, MARKET_SIZE);
  assert.equal(positionBytes().length, POSITION_SIZE);
  assert.equal(MARKET_POOL_OFFSET, 8);
  assert.equal(POSITION_MARKET_OFFSET, 8);
  assert.equal(POSITION_OWNER_OFFSET, 40);
});

// ---- PDAs ----

test('PDAs derive from the seeds in lib.rs and are stable', () => {
  const [market, bump] = marketPda(POOL, DEADLINE);
  const expected = PublicKey.findProgramAddressSync([Buffer.from('market'), key(POOL), i64(DEADLINE)], new PublicKey(CURVE_MARKET_PROGRAM));
  assert.equal(market.toBase58(), expected[0].toBase58());
  assert.equal(bump, expected[1]);
  // a different deadline is a different market on the same pool
  assert.notEqual(marketPda(POOL, DEADLINE + 1)[0].toBase58(), market.toBase58());
  // the deadline seed is the i64 little-endian bytes: a negative deadline must not throw and must differ
  assert.notEqual(marketPda(POOL, -1)[0].toBase58(), marketPda(POOL, 0xffffffff)[0].toBase58());
  const [vault] = vaultPda(market);
  assert.equal(vault.toBase58(), PublicKey.findProgramAddressSync([Buffer.from('vault'), market.toBuffer()], new PublicKey(CURVE_MARKET_PROGRAM))[0].toBase58());
  const [position] = positionPda(market, USER);
  assert.equal(position.toBase58(), PublicKey.findProgramAddressSync([Buffer.from('position'), market.toBuffer(), key(USER)], new PublicKey(CURVE_MARKET_PROGRAM))[0].toBase58());
  assert.notEqual(positionPda(market, OTHER)[0].toBase58(), position.toBase58());
});

test('the market PDA matches the Solana CLI', () => {
  // `solana find-program-derived-address DPsFa2...AQjp string:market pubkey:HC7Q...qPuf hex:c07dc06a00000000` prints this address
  const [market] = marketPda(POOL, DEADLINE);
  assert.equal(market.toBase58(), '9479J3NxmkXFKPW9DbUQdkPniTvuZ6vbR83Lq2EQmVtk');
  assert.equal(Buffer.from(i64(DEADLINE)).toString('hex'), 'c07dc06a00000000');
});

test('associated token addresses derive with the token program in the middle seed', () => {
  const ata = associatedTokenAddress(USER, NATIVE_MINT);
  const expected = PublicKey.findProgramAddressSync([key(USER), key(TOKEN_PROGRAM), key(NATIVE_MINT)], new PublicKey(ASSOCIATED_TOKEN_PROGRAM))[0];
  assert.equal(ata.toBase58(), expected.toBase58());
  // the wSOL ATA of the devnet wallet, as `spl-token address --owner FHj8...r513 --token So111...112 --verbose` prints it
  assert.equal(ata.toBase58(), 'HsaQrQ9MYdRw9J9W7Rc4a9MyFMuGSe7G22T79AbQ4Ff');
});

// ---- instruction data ----

test('instruction data is the IDL discriminator followed by Borsh args', () => {
  assert.equal(Buffer.from(encodeCreateMarket(DEADLINE)).toString('hex'), ixDisc('create_market').toString('hex') + 'c07dc06a00000000');
  assert.equal(Buffer.from(encodeCreateMarket(-1)).toString('hex'), ixDisc('create_market').toString('hex') + 'ffffffffffffffff');
  assert.equal(Buffer.from(encodeStake('yes', 1_000_000n)).toString('hex'), ixDisc('stake').toString('hex') + '00' + '40420f0000000000');
  assert.equal(Buffer.from(encodeStake('no', 2_500_000_000n)).toString('hex'), ixDisc('stake').toString('hex') + '01' + '00f9029500000000');
  assert.equal(Buffer.from(encodeResolve()).toString('hex'), ixDisc('resolve').toString('hex'));
  assert.equal(Buffer.from(encodeClaim()).toString('hex'), ixDisc('claim').toString('hex'));
  assert.equal(encodeCreateMarket(1).length, 16);
  assert.equal(encodeStake('yes', 1n).length, 17);
});

test('instruction accounts follow the IDL order and flags', () => {
  const user = new PublicKey(USER);
  const keysOf = (ix: { keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] }) => ix.keys.map((k) => `${k.pubkey.toBase58()}:${k.isSigner ? 's' : '-'}${k.isWritable ? 'w' : '-'}`);
  const { ix: create, market, vault } = createMarketIx(user, { pool: POOL, config: CONFIG, quoteMint: NATIVE_MINT, tokenProgram: TOKEN_PROGRAM }, DEADLINE);
  assert.equal(create.programId.toBase58(), CURVE_MARKET_PROGRAM);
  assert.deepEqual(keysOf(create), [`${USER}:sw`, `${POOL}:--`, `${CONFIG}:--`, `${NATIVE_MINT}:--`, `${market.toBase58()}:-w`, `${vault.toBase58()}:-w`, `${TOKEN_PROGRAM}:--`, '11111111111111111111111111111111:--']);
  const names = (n: string) => (idl.instructions.find((i) => i.name === n)!.accounts as { name: string }[]).map((a) => a.name);
  assert.equal(create.keys.length, names('create_market').length);

  const m = decodeMarket(marketBytes(), market.toBase58());
  const [position] = positionPda(market, user);
  const ata = associatedTokenAddress(user, NATIVE_MINT);
  const stake = stakeIx(user, m, ata, 'no', 5n);
  assert.deepEqual(keysOf(stake), [`${USER}:sw`, `${market.toBase58()}:-w`, `${position.toBase58()}:-w`, `${NATIVE_MINT}:--`, `${ata.toBase58()}:-w`, `${vault.toBase58()}:-w`, `${TOKEN_PROGRAM}:--`, '11111111111111111111111111111111:--']);
  assert.equal(stake.keys.length, names('stake').length);
  assert.equal(stake.data[8], 1);

  const resolve = resolveIx(m);
  assert.deepEqual(keysOf(resolve), [`${market.toBase58()}:-w`, `${POOL}:--`, `${CONFIG}:--`]);
  assert.equal(resolve.keys.length, names('resolve').length);

  const claim = claimIx(user, m, ata);
  assert.deepEqual(keysOf(claim), [`${USER}:sw`, `${market.toBase58()}:-w`, `${position.toBase58()}:-w`, `${NATIVE_MINT}:--`, `${ata.toBase58()}:-w`, `${vault.toBase58()}:-w`, `${TOKEN_PROGRAM}:--`]);
  assert.equal(claim.keys.length, names('claim').length);
});

test('the wrapped-SOL stake plan wraps, syncs, stakes and unwraps a fresh ATA', () => {
  const user = new PublicKey(USER);
  const m = decodeMarket(marketBytes(), marketPda(POOL, DEADLINE)[0].toBase58());
  const ata = associatedTokenAddress(user, NATIVE_MINT);
  const fresh = stakePlan(user, m, 'yes', 7_000_000n, false);
  const programs = fresh.map((i) => i.programId.toBase58());
  assert.deepEqual(programs, [ASSOCIATED_TOKEN_PROGRAM, '11111111111111111111111111111111', TOKEN_PROGRAM, CURVE_MARKET_PROGRAM, TOKEN_PROGRAM]);
  assert.equal(fresh[0].data[0], 1); // CreateIdempotent
  assert.equal(fresh[1].keys[1].pubkey.toBase58(), ata.toBase58()); // transfer lands in the ATA
  assert.equal(fresh[1].data.readBigUInt64LE(4), 7_000_000n); // system transfer: u32 tag then lamports
  assert.equal(fresh[2].data[0], 17); // SyncNative
  assert.equal(fresh[4].data[0], 9); // CloseAccount back to the user
  assert.equal(fresh[4].keys[1].pubkey.toBase58(), USER);
  // an existing ATA is used as it is and left open
  const existing = stakePlan(user, m, 'yes', 7_000_000n, true);
  assert.deepEqual(existing.map((i) => i.programId.toBase58()), ['11111111111111111111111111111111', TOKEN_PROGRAM, CURVE_MARKET_PROGRAM]);
  // a non-native mint: no wrap, no sync, no close
  const usdc = { ...m, quoteMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' };
  assert.deepEqual(stakePlan(user, usdc, 'no', 1_000_000n, true).map((i) => i.programId.toBase58()), [CURVE_MARKET_PROGRAM]);
  assert.deepEqual(stakePlan(user, usdc, 'no', 1_000_000n, false).map((i) => i.programId.toBase58()), [ASSOCIATED_TOKEN_PROGRAM, CURVE_MARKET_PROGRAM]);
});

test('the claim plan creates the ATA when missing and unwraps SOL', () => {
  const user = new PublicKey(USER);
  const m = decodeMarket(marketBytes({ state: 2 }), marketPda(POOL, DEADLINE)[0].toBase58());
  assert.deepEqual(claimPlan(user, m, false).map((i) => i.programId.toBase58()), [ASSOCIATED_TOKEN_PROGRAM, CURVE_MARKET_PROGRAM, TOKEN_PROGRAM]);
  assert.deepEqual(claimPlan(user, m, true).map((i) => i.programId.toBase58()), [CURVE_MARKET_PROGRAM, TOKEN_PROGRAM]);
  const usdc = { ...m, quoteMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' };
  assert.deepEqual(claimPlan(user, usdc, true).map((i) => i.programId.toBase58()), [CURVE_MARKET_PROGRAM]);
});

// ---- account decoding ----

test('decodeMarket reads every field of the IDL layout', () => {
  const [market] = marketPda(POOL, DEADLINE);
  const m = decodeMarket(marketBytes({ yes: 3_000_000n, no: 1_000_000n, paid: 0n, state: 1, resolvedAt: DEADLINE - 10 }), market.toBase58());
  assert.equal(m.address, market.toBase58());
  assert.equal(m.pool, POOL); assert.equal(m.config, CONFIG); assert.equal(m.quoteMint, NATIVE_MINT); assert.equal(m.tokenProgram, TOKEN_PROGRAM);
  assert.equal(m.vault, vaultPda(market)[0].toBase58()); assert.equal(m.creator, USER);
  assert.equal(m.deadlineTs, DEADLINE); assert.equal(m.thresholdRaw, '10000000000');
  assert.equal(m.yesTotalRaw, '3000000'); assert.equal(m.noTotalRaw, '1000000'); assert.equal(m.paidOutRaw, '0');
  assert.equal(m.state, 'yes'); assert.equal(m.resolvedAt, DEADLINE - 10);
  assert.equal(m.bump, marketPda(POOL, DEADLINE)[1]); assert.equal(m.vaultBump, vaultPda(market)[1]);
  assert.equal(decodeMarket(marketBytes()).resolvedAt, null);
  assert.equal(decodeMarket(marketBytes({ state: 3 })).state, 'refund');
  assert.equal(decodeMarket(marketBytes({ state: 2 })).state, 'no');
});

test('decodeMarket rejects other accounts and short buffers', () => {
  assert.throws(() => decodeMarket(positionBytes()), /not a Market/);
  assert.throws(() => decodeMarket(marketBytes().subarray(0, 100)), /not a Market/);
  assert.throws(() => decodeMarket(Buffer.concat([accDisc('Market'), Buffer.alloc(MARKET_SIZE - 8, 0)]).fill(9, 240, 241)), /unknown market state/);
});

test('decodePosition reads the IDL layout', () => {
  const [market] = marketPda(POOL, DEADLINE);
  const p = decodePosition(positionBytes({ yes: 2_000_000n, no: 0n, claimed: false }), 'addr');
  assert.equal(p.address, 'addr'); assert.equal(p.market, market.toBase58()); assert.equal(p.owner, USER);
  assert.equal(p.yesAmountRaw, '2000000'); assert.equal(p.noAmountRaw, '0'); assert.equal(p.claimed, false);
  assert.equal(p.bump, positionPda(market, USER)[1]);
  assert.equal(decodePosition(positionBytes({ claimed: true })).claimed, true);
  assert.throws(() => decodePosition(marketBytes()), /not a Position/);
});

test('tokenAccountAmount reads the u64 at byte 64 of a token account', () => {
  const data = Buffer.alloc(165);
  data.writeBigUInt64LE(123_456_789n, 64);
  assert.equal(tokenAccountAmount(data), 123_456_789n);
  assert.throws(() => tokenAccountAmount(Buffer.alloc(10)), /not a token account/);
});

// ---- reads through a stubbed RPC ----

test('fetchMarkets and fetchPositions filter by size, discriminator and the memcmp offsets', async () => {
  const calls: { method: string; params: unknown[] }[] = [];
  const [market] = marketPda(POOL, DEADLINE);
  const call = async <T,>(method: string, params: unknown[]): Promise<T> => {
    calls.push({ method, params });
    const filters = (params[1] as { filters: unknown[] }).filters;
    const isMarkets = (filters[0] as { dataSize: number }).dataSize === MARKET_SIZE;
    const rows = isMarkets
      ? [{ pubkey: market.toBase58(), account: { data: [marketBytes({ yes: 5n }).toString('base64'), 'base64'], owner: CURVE_MARKET_PROGRAM } }, { pubkey: 'junk', account: { data: [Buffer.alloc(MARKET_SIZE).toString('base64'), 'base64'], owner: CURVE_MARKET_PROGRAM } }]
      : [{ pubkey: 'pos', account: { data: [positionBytes({ yes: 5n }).toString('base64'), 'base64'], owner: CURVE_MARKET_PROGRAM } }];
    return rows as unknown as T;
  };
  const markets = await fetchMarkets(call, POOL);
  assert.equal(markets.length, 1); // the junk row was skipped
  assert.equal(markets[0].yesTotalRaw, '5');
  const mf = (calls[0].params[1] as { filters: unknown[] }).filters;
  assert.deepEqual(mf[0], { dataSize: MARKET_SIZE });
  assert.deepEqual(mf[1], { memcmp: { offset: 0, bytes: bs58.encode(DISC.market) } });
  assert.deepEqual(mf[2], { memcmp: { offset: MARKET_POOL_OFFSET, bytes: POOL } });
  assert.equal(calls[0].params[0], CURVE_MARKET_PROGRAM);

  const positions = await fetchPositions(call, USER, market.toBase58());
  assert.equal(positions.length, 1);
  const pf = (calls[1].params[1] as { filters: unknown[] }).filters;
  assert.deepEqual(pf[0], { dataSize: POSITION_SIZE });
  assert.deepEqual(pf[2], { memcmp: { offset: POSITION_OWNER_OFFSET, bytes: USER } });
  assert.deepEqual(pf[3], { memcmp: { offset: POSITION_MARKET_OFFSET, bytes: market.toBase58() } });
});

test('rankMarkets lists open markets by deadline first, then settled ones newest first', () => {
  const mk = (deadlineTs: number, state: 'open' | 'yes' | 'no' | 'refund', resolvedAt: number | null) => ({ ...decodeMarket(marketBytes()), address: `${deadlineTs}:${state}`, deadlineTs, state, resolvedAt });
  const rows = rankMarkets([mk(300, 'no', 50), mk(200, 'open', null), mk(400, 'yes', 90), mk(100, 'open', null)]);
  assert.deepEqual(rows.map((r) => r.address), ['100:open', '200:open', '400:yes', '300:no']);
});

// ---- the math, mirroring lib.rs ----

test('payoutFor floors in u128 and never exceeds the pool', () => {
  assert.equal(payoutFor(1_000n, 1_000n, 2_000n), 2_000n); // even sides double
  assert.equal(payoutFor(0n, 1_000n, 2_000n), 0n);
  assert.equal(payoutFor(1n, 3n, 10n), 3n); // 10/3 floors
  assert.equal(payoutFor(1n, 3n, 10n) + payoutFor(1n, 3n, 10n) + payoutFor(1n, 3n, 10n), 9n); // dust stays in the vault
  const big = 18_000_000_000_000_000_000n; // near u64::MAX: the product needs u128
  assert.equal(payoutFor(big / 2n, big / 2n, big), big);
  assert.throws(() => payoutFor(5n, 0n, 10n), /zero winning total/);
});

test('positionPayout gives each outcome and the settled amount', () => {
  const m = { yesTotalRaw: '3000000', noTotalRaw: '1000000', state: 'open' as const };
  const p = { yesAmountRaw: '1000000', noAmountRaw: '1000000' };
  const r = positionPayout(m, p);
  assert.equal(r.ifYes, 1_333_333n); // 1e6 * 4e6 / 3e6 floored
  assert.equal(r.ifNo, 4_000_000n);  // the only NO stake takes the pool
  assert.equal(r.refund, 2_000_000n);
  assert.equal(r.now, null);
  assert.equal(positionPayout({ ...m, state: 'yes' }, p).now, 1_333_333n);
  assert.equal(positionPayout({ ...m, state: 'no' }, p).now, 4_000_000n);
  assert.equal(positionPayout({ ...m, state: 'refund' }, p).now, 2_000_000n);
  assert.equal(positionPayout({ yesTotalRaw: '0', noTotalRaw: '5', state: 'open' }, { yesAmountRaw: '0', noAmountRaw: '5' }).ifYes, 0n);
});

test('implied odds and side multiples come from the totals', () => {
  assert.equal(impliedOdds({ yesTotalRaw: '0', noTotalRaw: '0' }), null);
  assert.deepEqual(impliedOdds({ yesTotalRaw: '3', noTotalRaw: '1' }), { yes: 0.75, no: 0.25 });
  assert.equal(sideMultiple({ yesTotalRaw: '3', noTotalRaw: '1' }, 'yes'), 4 / 3);
  assert.equal(sideMultiple({ yesTotalRaw: '3', noTotalRaw: '1' }, 'no'), 4);
  assert.equal(sideMultiple({ yesTotalRaw: '0', noTotalRaw: '1' }, 'yes'), null);
});

test('decide follows the program: timestamp first, then migrated, then threshold in time, then the deadline', () => {
  const base = { finishCurveAt: null, status: 'trading' as const, quoteReserveRaw: '5', thresholdRaw: '10' };
  assert.equal(decide(base, 100, 50), null);
  assert.equal(decide(base, 100, 101), 'no');
  assert.equal(decide({ ...base, finishCurveAt: 90 }, 100, 50), 'yes');
  assert.equal(decide({ ...base, finishCurveAt: 101, status: 'migrated' }, 100, 500), 'no'); // the timestamp wins over is_migrated
  assert.equal(decide({ ...base, status: 'migrated' }, 100, 500), 'yes');
  assert.equal(decide({ ...base, quoteReserveRaw: '10' }, 100, 100), 'yes');
  assert.equal(decide({ ...base, quoteReserveRaw: '10' }, 100, 101), 'no'); // complete now, but seen only after the deadline
  assert.equal(resolvedState({ yesTotalRaw: '1', noTotalRaw: '0' }, 'yes'), 'refund');
  assert.equal(resolvedState({ yesTotalRaw: '1', noTotalRaw: '1' }, 'no'), 'no');
});

test('friendlyProgramError maps IDL error codes and wallet failures', () => {
  assert.equal(friendlyProgramError('Transaction simulation failed: custom program error: 0x177f'), 'The pool has not graduated and the deadline has not passed yet');
  assert.equal(friendlyProgramError('{"InstructionError":[0,{"Custom":6009}]}'), 'The pool has already graduated or filled its curve');
  assert.match(friendlyProgramError('Transfer: insufficient lamports 100, need 200'), /Not enough SOL/);
  assert.equal(friendlyProgramError('something else'), 'something else');
});
