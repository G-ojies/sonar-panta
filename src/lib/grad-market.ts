/**
 * Graduation markets on pm-AMM: the client side of the `grad_resolver` program (onchain/programs/grad_resolver).
 *
 * A market is a pm-AMM YES/NO market on "does this Meteora DBC pool graduate before the deadline?". Its pm-AMM
 * authority is a grad_resolver PDA, so no key picks the winner: `halt` pulls the liquidity once the pool shows the
 * outcome, `resolve` settles from the pool account after the deadline, `settle` returns the LP to the opener. A
 * keeper (.github/workflows/grad-keeper.yml) cranks those three; this module covers what a trader signs: open a
 * market, buy and sell outcome tokens, and claim winnings.
 *
 * Everything runs on devnet with pm-AMM's mUSDC collateral (its faucet hands out 1,000 per wallet). Layouts come
 * from the IDLs: Binding from grad_resolver's own struct, pm-AMM's Market from onchain/pm-amm-idl.json; the tests
 * check every offset against them.
 */
import { ComputeBudgetProgram, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, TransactionInstruction, type AccountMeta } from '@solana/web3.js';

export const GRAD_PROGRAM = '73G7X9FKEgTtNQMBWGsCGZfHHBpvVxsJ9kqvV6mvubJH';
export const PM_AMM_PROGRAM = 'GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y';
export const TOKEN_METADATA_PROGRAM = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';
export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const ASSOCIATED_TOKEN_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
/** pm-AMM takes half of its 2% swap fee into this owner's collateral account. */
export const PROTOCOL_DAO = '4qXyczAr5DuBVaHUwmZT5Xt6hgQ6RwqBYcFGtrv8QEph';
/** pm-AMM's devnet mock USDC, 6 decimals. */
export const MUSDC = '3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ';
export const MUSDC_DECIMALS = 6;
/** Browser-side devnet endpoint. Server reads use their own (grad-market-server.ts). */
export const GRAD_RPC = process.env.NEXT_PUBLIC_GRAD_RPC ?? 'https://api.devnet.solana.com';
export const PM_FAUCET = 'https://pm-amm-devnet.vercel.app/api/faucet';

/** `open_market` runs pm-AMM and Metaplex underneath: about 660k compute units. */
export const OPEN_MARKET_CU = 1_400_000;
export const SWAP_CU = 800_000;
/** SOL the opener moves to the market's PDA for pm-AMM's rent. */
export const AUTHORITY_FUNDING_SOL = 0.06;

// ---- layouts ----

/** grad_resolver `Binding`: discriminator, 5 pubkeys, deadline, threshold, market_id, seed, 3 flags, 2 bumps. */
export const BINDING_SIZE = 8 + 5 * 32 + 4 * 8 + 3 + 2;
export const BINDING = { pool: 8, config: 40, pmMarket: 72, opener: 104, collateralMint: 136, deadline: 168, threshold: 176, marketId: 184, seed: 192, halted: 200, resolved: 201, settled: 202 } as const;

/** pm-AMM `Market` field offsets, discriminator included. */
export const PM_MARKET = {
  authority: 8, marketId: 40, collateralMint: 48, yesMint: 80, noMint: 112, vault: 144, startTs: 176, endTs: 184,
  lZero: 192, reserveYes: 208, reserveNo: 224, lastAccrualTs: 240, resolved: 312, winningSide: 313,
} as const;

/** Anchor discriminators: sha256("account:Binding") and sha256("global:open_market"), first 8 bytes. */
export const DISC = {
  binding: Uint8Array.from([148, 194, 179, 54, 81, 210, 85, 178]),
  openMarket: Uint8Array.from([116, 19, 123, 75, 217, 244, 69, 44]),
  swap: Uint8Array.from([248, 198, 158, 145, 225, 117, 135, 200]),
  claimWinnings: Uint8Array.from([161, 215, 24, 59, 14, 236, 242, 221]),
};

export type Side = 'yes' | 'no';
/** pm-AMM `SwapDirection` variants this app uses. */
export const DIRECTION = { buyYes: 0, buyNo: 1, sellYes: 2, sellNo: 3 } as const;
export type Direction = keyof typeof DIRECTION;

export interface GradBinding {
  address: string;
  pool: string;
  config: string;
  pmMarket: string;
  opener: string;
  collateralMint: string;
  deadlineTs: number;
  thresholdRaw: string;
  seedRaw: string;
  halted: boolean;
  resolved: boolean;
  settled: boolean;
}

export interface PmMarketState {
  authority: string;
  collateralMint: string;
  yesMint: string;
  noMint: string;
  vault: string;
  endTs: number;
  /** I80F48 bits, as decimal strings so they survive JSON. */
  lZeroBits: string;
  reserveYesBits: string;
  reserveNoBits: string;
  lastAccrualTs: number;
  resolved: boolean;
  /** pm-AMM stores the winner as 1 for YES, 2 for NO, 0 while open. */
  winningSide: 0 | 1 | 2;
}

const pk = (d: Uint8Array, o: number) => new PublicKey(d.subarray(o, o + 32)).toBase58();
const dv = (d: Uint8Array) => new DataView(d.buffer, d.byteOffset, d.byteLength);
const u128 = (d: Uint8Array, o: number) => dv(d).getBigUint64(o, true) + (dv(d).getBigUint64(o + 8, true) << 64n);

export function decodeBinding(data: Uint8Array, address = ''): GradBinding {
  if (data.length < BINDING_SIZE || !DISC.binding.every((b, i) => data[i] === b)) throw new Error('grad: not a Binding account');
  const v = dv(data);
  return {
    address,
    pool: pk(data, BINDING.pool),
    config: pk(data, BINDING.config),
    pmMarket: pk(data, BINDING.pmMarket),
    opener: pk(data, BINDING.opener),
    collateralMint: pk(data, BINDING.collateralMint),
    deadlineTs: Number(v.getBigInt64(BINDING.deadline, true)),
    thresholdRaw: v.getBigUint64(BINDING.threshold, true).toString(),
    seedRaw: v.getBigUint64(BINDING.seed, true).toString(),
    halted: data[BINDING.halted] === 1,
    resolved: data[BINDING.resolved] === 1,
    settled: data[BINDING.settled] === 1,
  };
}

export function decodePmMarket(data: Uint8Array): PmMarketState {
  const v = dv(data);
  const side = data[PM_MARKET.winningSide];
  return {
    authority: pk(data, PM_MARKET.authority),
    collateralMint: pk(data, PM_MARKET.collateralMint),
    yesMint: pk(data, PM_MARKET.yesMint),
    noMint: pk(data, PM_MARKET.noMint),
    vault: pk(data, PM_MARKET.vault),
    endTs: Number(v.getBigInt64(PM_MARKET.endTs, true)),
    lZeroBits: u128(data, PM_MARKET.lZero).toString(),
    reserveYesBits: u128(data, PM_MARKET.reserveYes).toString(),
    reserveNoBits: u128(data, PM_MARKET.reserveNo).toString(),
    lastAccrualTs: Number(v.getBigInt64(PM_MARKET.lastAccrualTs, true)),
    resolved: data[PM_MARKET.resolved] === 1,
    winningSide: side === 1 || side === 2 ? side : 0,
  };
}

// ---- pricing (display only; the program does the real math in fixed point) ----

/** I80F48 bits to a float, keeping the fractional part. */
export function fixedToNumber(bits: string | bigint): number {
  const b = BigInt(bits);
  const scale = 1n << 48n;
  return Number(b / scale) + Number(b % scale) / 2 ** 48;
}

/** Standard normal CDF (Abramowitz and Stegun 7.1.26), as pm-AMM's own SDK computes it. */
export function normCdf(z: number): number {
  if (z < -8) return 0;
  if (z > 8) return 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + Math.sign(z) * erf);
}

/**
 * The YES price in [0, 1]: P = Phi((y - x) / L_eff) with x the YES reserve, y the NO reserve and
 * L_eff = L_0 * sqrt(end_ts - last_accrual_ts), the liquidity at the moment the reserves were last written.
 * 1 or 0 once resolved; null while the market has no liquidity (halted).
 */
export function yesPrice(m: PmMarketState): number | null {
  if (m.resolved) return m.winningSide === 1 ? 1 : m.winningSide === 2 ? 0 : null;
  const l0 = fixedToNumber(m.lZeroBits);
  const remaining = m.endTs - m.lastAccrualTs;
  if (l0 <= 0 || remaining <= 0) return null;
  const lEff = l0 * Math.sqrt(remaining);
  return normCdf((fixedToNumber(m.reserveNoBits) - fixedToNumber(m.reserveYesBits)) / lEff);
}

export type MarketPhase = 'trading' | 'halted' | 'resolved-yes' | 'resolved-no' | 'expired';

/** Where a market stands, from the binding and the pm-AMM market. */
export function phaseOf(b: GradBinding, m: PmMarketState | null, now: number): MarketPhase {
  if (m?.resolved) return m.winningSide === 1 ? 'resolved-yes' : 'resolved-no';
  if (b.halted) return 'halted';
  if (now >= b.deadlineTs) return 'expired';
  return 'trading';
}

// ---- addresses ----

const key = (k: string | PublicKey) => (typeof k === 'string' ? new PublicKey(k) : k);
const pda = (seeds: Uint8Array[], program: string) => PublicKey.findProgramAddressSync(seeds, new PublicKey(program))[0];
const utf8 = (s: string) => new TextEncoder().encode(s);

export function i64le(n: number | bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigInt64(0, BigInt(n), true);
  return b;
}
export function u64le(n: number | bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n), true);
  return b;
}
const u16le = (n: number) => Uint8Array.of(n & 0xff, (n >> 8) & 0xff);
const u32le = (n: number) => Uint8Array.of(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff);
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

export const bindingPda = (pool: string | PublicKey, deadlineTs: number) => pda([utf8('binding'), key(pool).toBytes(), i64le(deadlineTs)], GRAD_PROGRAM);

export function ata(owner: string | PublicKey, mint: string | PublicKey): PublicKey {
  return pda([key(owner).toBytes(), new PublicKey(TOKEN_PROGRAM).toBytes(), key(mint).toBytes()], ASSOCIATED_TOKEN_PROGRAM);
}

/** Every account a binding implies. */
export function deriveMarket(binding: string | PublicKey) {
  const b = key(binding);
  const authority = pda([utf8('authority'), b.toBytes()], GRAD_PROGRAM);
  const pmMarket = pda([utf8('market'), b.toBytes().subarray(0, 8)], PM_AMM_PROGRAM);
  const yesMint = pda([utf8('yes_mint'), pmMarket.toBytes()], PM_AMM_PROGRAM);
  const noMint = pda([utf8('no_mint'), pmMarket.toBytes()], PM_AMM_PROGRAM);
  const metadata = (mint: PublicKey) => pda([utf8('metadata'), new PublicKey(TOKEN_METADATA_PROGRAM).toBytes(), mint.toBytes()], TOKEN_METADATA_PROGRAM);
  return {
    authority, pmMarket, yesMint, noMint,
    pmVault: pda([utf8('vault'), pmMarket.toBytes()], PM_AMM_PROGRAM),
    lpPosition: pda([utf8('lp'), pmMarket.toBytes(), authority.toBytes()], PM_AMM_PROGRAM),
    collateral: pda([utf8('collateral'), b.toBytes()], GRAD_PROGRAM),
    yesMeta: metadata(yesMint),
    noMeta: metadata(noMint),
  };
}

// ---- instructions ----

const w = (k: string | PublicKey, signer = false): AccountMeta => ({ pubkey: key(k), isSigner: signer, isWritable: true });
const r = (k: string | PublicKey): AccountMeta => ({ pubkey: key(k), isSigner: false, isWritable: false });
const ix = (programId: string, keys: AccountMeta[], data: Uint8Array) => new TransactionInstruction({ programId: new PublicKey(programId), keys, data: Buffer.from(data) });

/** Create an associated token account unless it exists (the ATA program's idempotent instruction). */
export const createAtaIdempotent = (payer: PublicKey, owner: string | PublicKey, mint: string | PublicKey) =>
  ix(ASSOCIATED_TOKEN_PROGRAM, [w(payer, true), w(ata(owner, mint)), r(owner), r(mint), r(SystemProgram.programId), r(TOKEN_PROGRAM)], Uint8Array.of(1));

export function encodeOpenMarket(deadlineTs: number, priceBps: number, seedRaw: bigint, name: string): Uint8Array {
  const n = utf8(name);
  return concat(DISC.openMarket, i64le(deadlineTs), u16le(priceBps), u64le(seedRaw), u32le(n.length), n);
}

/** Open a market on `pool` and seed it with `seedRaw` mUSDC from the opener; returns the binding address too. */
export function openMarketPlan(opener: PublicKey, pool: { address: string; config: string }, deadlineTs: number, seedRaw: bigint, priceBps = 5000) {
  const binding = bindingPda(pool.address, deadlineTs);
  const d = deriveMarket(binding);
  const name = `Graduates by ${new Date(deadlineTs * 1000).toISOString().slice(0, 16)}Z?`;
  const open = ix(GRAD_PROGRAM, [
    w(opener, true), r(pool.address), r(pool.config), w(binding), w(d.authority), r(MUSDC), w(ata(opener, MUSDC)), w(d.collateral),
    w(d.pmMarket), w(d.yesMint), w(d.noMint), w(d.pmVault), w(d.yesMeta), w(d.noMeta), w(d.lpPosition),
    r(PM_AMM_PROGRAM), r(TOKEN_METADATA_PROGRAM), r(TOKEN_PROGRAM), r(SystemProgram.programId), r(SYSVAR_RENT_PUBKEY),
  ], encodeOpenMarket(deadlineTs, priceBps, seedRaw, name));
  return { binding: binding.toBase58(), instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: OPEN_MARKET_CU }), open] };
}

export const encodeSwap = (direction: Direction, amountRaw: bigint, minOutRaw = 0n) => concat(DISC.swap, Uint8Array.of(DIRECTION[direction]), u64le(amountRaw), u64le(minOutRaw));

/**
 * Trade straight through pm-AMM: buy YES or NO with mUSDC, or sell them back. Creates the trader's outcome-token
 * accounts and the protocol fee account when missing. The creator half of the fee goes to the market's PDA.
 */
export function swapPlan(user: PublicKey, binding: string, m: Pick<PmMarketState, 'yesMint' | 'noMint' | 'vault'>, direction: Direction, amountRaw: bigint): TransactionInstruction[] {
  const d = deriveMarket(binding);
  const swap = ix(PM_AMM_PROGRAM, [
    w(user, true), w(d.pmMarket), r(MUSDC), w(m.yesMint), w(m.noMint), w(m.vault),
    w(ata(user, MUSDC)), w(ata(user, m.yesMint)), w(ata(user, m.noMint)), w(ata(PROTOCOL_DAO, MUSDC)), w(d.collateral), r(TOKEN_PROGRAM),
  ], encodeSwap(direction, amountRaw));
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: SWAP_CU }),
    createAtaIdempotent(user, user, m.yesMint),
    createAtaIdempotent(user, user, m.noMint),
    createAtaIdempotent(user, PROTOCOL_DAO, MUSDC),
    swap,
  ];
}

/** Burn the winning outcome tokens for mUSDC once the market is resolved. pm-AMM claims the whole winning balance. */
export function claimPlan(user: PublicKey, binding: string, m: Pick<PmMarketState, 'yesMint' | 'noMint' | 'vault'>): TransactionInstruction[] {
  const d = deriveMarket(binding);
  return [ix(PM_AMM_PROGRAM, [
    w(user, true), r(d.pmMarket), r(MUSDC), w(m.yesMint), w(m.noMint), w(m.vault),
    w(ata(user, m.yesMint)), w(ata(user, m.noMint)), w(ata(user, MUSDC)), r(TOKEN_PROGRAM),
  ], concat(DISC.claimWinnings, u64le(0)))];
}

/** Readable text for the errors a trader is likely to hit. */
export function friendlyGradError(message: string): string {
  const m = message ?? '';
  if (/InsufficientLiquidity|0x1774/.test(m)) return 'This market has no liquidity: the outcome is known and trading has stopped.';
  if (/MarketExpired|0x1772/.test(m)) return 'The market has passed its deadline; trading is closed.';
  if (/MarketAlreadyResolved/.test(m)) return 'The market is already resolved.';
  if (/PoolAlreadyComplete/.test(m)) return 'That pool has already graduated, so there is nothing left to predict.';
  if (/DeadlineTooSoon/.test(m)) return 'Pick a deadline at least five minutes away.';
  if (/insufficient funds|0x1\b/.test(m)) return 'Not enough mUSDC or SOL in this wallet. Use the faucet button for test funds.';
  if (/already in use/.test(m)) return 'A market with this pool and deadline already exists.';
  return m.split('\n')[0].slice(0, 300);
}
