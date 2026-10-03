/**
 * curve_market, from the browser and the server: PDAs, account decoders, instruction builders and read helpers for
 * the graduation-market program (onchain/programs/curve_market, IDL at onchain/idl/curve_market.json).
 *
 * No Anchor client and no SPL token library: the discriminators are copied from the IDL (and checked against it in
 * tests/curve-market.test.ts), the arguments are Borsh (little-endian integers, a one-byte enum), and the token
 * instructions the stake and claim paths need (associated token account, SyncNative, CloseAccount) are the standard
 * layouts written out by hand. Everything here works with plain Uint8Arrays so the browser bundle stays small.
 *
 * The program is deployed on devnet only (CURVE_MARKET_PROGRAMS). A mainnet deployment is one line in that map.
 */
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import bs58 from 'bs58';

export type Cluster = 'devnet' | 'mainnet-beta';

/** Where the program lives. null means not deployed on that cluster. */
export const CURVE_MARKET_PROGRAMS: Record<Cluster, string | null> = {
  devnet: 'DPsFa2nxH568WZdeAgmdaxBrS3Je4UK4K7axxzCYAqjp',
  'mainnet-beta': null,
};
export const CURVE_MARKET_PROGRAM = CURVE_MARKET_PROGRAMS.devnet!;
export const DEVNET_RPC = 'https://api.devnet.solana.com';

export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const ASSOCIATED_TOKEN_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
export const NATIVE_MINT = 'So11111111111111111111111111111111111111112';
export const NATIVE_MINT_2022 = '9pan9bMn5HatX4EJdBwg9VgCa7Uz5HL8N1m5D3NdXejP';

export { MIN_STAKE, MAX_DEADLINE_SECS, payoutFor, positionPayout, impliedOdds, sideMultiple, decide, resolvedState, type Side, type MarketState } from './curve-market-math';
import type { Side, MarketState } from './curve-market-math';

// ---- IDL constants (checked against onchain/idl/curve_market.json in the tests) ----

export const DISC = {
  createMarket: Uint8Array.from([103, 226, 97, 235, 200, 188, 251, 254]),
  stake: Uint8Array.from([206, 176, 202, 18, 200, 209, 179, 108]),
  resolve: Uint8Array.from([246, 150, 236, 206, 108, 63, 58, 10]),
  claim: Uint8Array.from([62, 198, 214, 193, 213, 159, 108, 210]),
  market: Uint8Array.from([219, 190, 213, 55, 0, 227, 198, 154]),
  position: Uint8Array.from([170, 188, 143, 228, 122, 64, 247, 208]),
};
export const MARKET_SIZE = 251;
export const POSITION_SIZE = 90;
/** Byte offsets inside the account data (discriminator included), for memcmp filters. */
export const MARKET_POOL_OFFSET = 8;
export const POSITION_MARKET_OFFSET = 8;
export const POSITION_OWNER_OFFSET = 40;

const STATES: MarketState[] = ['open', 'yes', 'no', 'refund'];
export const SIDE_INDEX: Record<Side, number> = { yes: 0, no: 1 };

/** Error codes from the IDL, for friendly messages. */
export const ERRORS: Record<number, string> = {
  6000: 'The pool account is not owned by the DBC program', 6001: 'The pool account is not a DBC pool this program accepts (VirtualPool or TransferHookPool)', 6002: 'The pool account is too short',
  6003: 'The config account is not owned by the DBC program', 6004: 'The config account is not a PoolConfig or ConfigWithTransferHook', 6005: 'The config account is too short',
  6006: 'The config does not match the pool', 6007: 'The quote mint does not match the config', 6008: 'The quote mint is not owned by the token program given',
  6009: 'The pool has already graduated or filled its curve', 6010: 'The deadline is not in the future', 6011: 'The deadline is more than 180 days away',
  6012: 'The market is no longer open', 6013: 'The deadline has passed, so the market takes no new stakes', 6014: 'The stake is below the minimum',
  6015: 'The pool has not graduated and the deadline has not passed yet', 6016: 'The market has not been resolved', 6017: 'The position belongs to a different market',
  6018: 'The position has already been claimed', 6019: 'Arithmetic overflow', 6020: 'The vault does not match the market', 6021: 'The pool does not match the market',
  6022: 'The pool and its config are different DBC kinds',
};

// ---- small Borsh helpers ----

const u64le = (n: bigint | number) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n), true); return b; };
const i64le = (n: bigint | number) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigInt64(0, BigInt(n), true); return b; };
const concat = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

class Reader {
  off = 0;
  private dv: DataView;
  constructor(public buf: Uint8Array) { this.dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength); }
  u8() { return this.buf[this.off++]; }
  u64() { const v = this.dv.getBigUint64(this.off, true); this.off += 8; return v; }
  i64() { const v = this.dv.getBigInt64(this.off, true); this.off += 8; return v; }
  pubkey() { const v = bs58.encode(this.buf.subarray(this.off, this.off + 32)); this.off += 32; return v; }
}

// ---- PDAs ----

const pk = (s: string | PublicKey) => (typeof s === 'string' ? new PublicKey(s) : s);
/** A PublicKey from a base-58 string, for callers that load this module lazily and have no web3.js import of their own. */
export const pubkey = (s: string) => new PublicKey(s);
const enc = (s: string) => new TextEncoder().encode(s);

export function marketPda(pool: string | PublicKey, deadlineTs: number | bigint, program = CURVE_MARKET_PROGRAM): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc('market'), pk(pool).toBytes(), i64le(deadlineTs)], pk(program));
}
export function vaultPda(market: string | PublicKey, program = CURVE_MARKET_PROGRAM): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc('vault'), pk(market).toBytes()], pk(program));
}
export function positionPda(market: string | PublicKey, user: string | PublicKey, program = CURVE_MARKET_PROGRAM): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc('position'), pk(market).toBytes(), pk(user).toBytes()], pk(program));
}
/** The associated token account of `owner` for `mint` under `tokenProgram` (Token or Token-2022). */
export function associatedTokenAddress(owner: string | PublicKey, mint: string | PublicKey, tokenProgram: string | PublicKey = TOKEN_PROGRAM): PublicKey {
  return PublicKey.findProgramAddressSync([pk(owner).toBytes(), pk(tokenProgram).toBytes(), pk(mint).toBytes()], new PublicKey(ASSOCIATED_TOKEN_PROGRAM))[0];
}
export const isNativeMint = (mint: string) => mint === NATIVE_MINT || mint === NATIVE_MINT_2022;

// ---- accounts ----

export interface MarketAccount {
  address: string;
  pool: string; config: string; quoteMint: string; tokenProgram: string; vault: string; creator: string;
  deadlineTs: number;
  /** Raw units of the quote token, as decimal strings (u64 does not fit a JS number). */
  thresholdRaw: string; yesTotalRaw: string; noTotalRaw: string; paidOutRaw: string;
  state: MarketState;
  resolvedAt: number | null;
  bump: number; vaultBump: number;
}
export interface PositionAccount {
  address: string;
  market: string; owner: string;
  yesAmountRaw: string; noAmountRaw: string;
  claimed: boolean; bump: number;
}

export function decodeMarket(data: Uint8Array, address = ''): MarketAccount {
  if (data.length < MARKET_SIZE || !same(data.subarray(0, 8), DISC.market)) throw new Error('curve-market: not a Market account');
  const r = new Reader(data); r.off = 8;
  const pool = r.pubkey(), config = r.pubkey(), quoteMint = r.pubkey(), tokenProgram = r.pubkey(), vault = r.pubkey(), creator = r.pubkey();
  const deadlineTs = Number(r.i64());
  const thresholdRaw = String(r.u64()), yesTotalRaw = String(r.u64()), noTotalRaw = String(r.u64()), paidOutRaw = String(r.u64());
  const state = STATES[r.u8()];
  if (!state) throw new Error('curve-market: unknown market state');
  const resolvedAt = Number(r.i64());
  const bump = r.u8(), vaultBump = r.u8();
  return { address, pool, config, quoteMint, tokenProgram, vault, creator, deadlineTs, thresholdRaw, yesTotalRaw, noTotalRaw, paidOutRaw, state, resolvedAt: resolvedAt || null, bump, vaultBump };
}

export function decodePosition(data: Uint8Array, address = ''): PositionAccount {
  if (data.length < POSITION_SIZE || !same(data.subarray(0, 8), DISC.position)) throw new Error('curve-market: not a Position account');
  const r = new Reader(data); r.off = 8;
  const market = r.pubkey(), owner = r.pubkey();
  const yesAmountRaw = String(r.u64()), noAmountRaw = String(r.u64());
  const claimed = r.u8() !== 0;
  const bump = r.u8();
  return { address, market, owner, yesAmountRaw, noAmountRaw, claimed, bump };
}

/** Amount of an SPL token account (legacy or Token-2022, both put the u64 at byte 64). */
export function tokenAccountAmount(data: Uint8Array): bigint {
  if (data.length < 72) throw new Error('curve-market: not a token account');
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(64, true);
}

// ---- instruction data ----

export const encodeCreateMarket = (deadlineTs: number | bigint) => concat(DISC.createMarket, i64le(deadlineTs));
export const encodeStake = (side: Side, amount: bigint | number) => concat(DISC.stake, Uint8Array.of(SIDE_INDEX[side]), u64le(amount));
export const encodeResolve = () => DISC.resolve.slice();
export const encodeClaim = () => DISC.claim.slice();

// ---- instructions ----

const meta = (pubkey: PublicKey, isWritable = false, isSigner = false) => ({ pubkey, isWritable, isSigner });
const SYSTEM = SystemProgram.programId;

export interface MarketKeys { pool: string; config: string; quoteMint: string; tokenProgram: string }

export function createMarketIx(creator: PublicKey, keys: MarketKeys, deadlineTs: number, program = CURVE_MARKET_PROGRAM): { ix: TransactionInstruction; market: PublicKey; vault: PublicKey } {
  const [market] = marketPda(keys.pool, deadlineTs, program);
  const [vault] = vaultPda(market, program);
  const ix = new TransactionInstruction({
    programId: pk(program),
    keys: [meta(creator, true, true), meta(pk(keys.pool)), meta(pk(keys.config)), meta(pk(keys.quoteMint)), meta(market, true), meta(vault, true), meta(pk(keys.tokenProgram)), meta(SYSTEM)],
    data: Buffer.from(encodeCreateMarket(deadlineTs)),
  });
  return { ix, market, vault };
}

export function stakeIx(user: PublicKey, m: Pick<MarketAccount, 'address' | 'quoteMint' | 'tokenProgram' | 'vault'>, userToken: PublicKey, side: Side, amount: bigint, program = CURVE_MARKET_PROGRAM): TransactionInstruction {
  const [position] = positionPda(m.address, user, program);
  return new TransactionInstruction({
    programId: pk(program),
    keys: [meta(user, true, true), meta(pk(m.address), true), meta(position, true), meta(pk(m.quoteMint)), meta(userToken, true), meta(pk(m.vault), true), meta(pk(m.tokenProgram)), meta(SYSTEM)],
    data: Buffer.from(encodeStake(side, amount)),
  });
}

export function resolveIx(m: Pick<MarketAccount, 'address' | 'pool' | 'config'>, program = CURVE_MARKET_PROGRAM): TransactionInstruction {
  return new TransactionInstruction({ programId: pk(program), keys: [meta(pk(m.address), true), meta(pk(m.pool)), meta(pk(m.config))], data: Buffer.from(encodeResolve()) });
}

export function claimIx(user: PublicKey, m: Pick<MarketAccount, 'address' | 'quoteMint' | 'tokenProgram' | 'vault'>, userToken: PublicKey, program = CURVE_MARKET_PROGRAM): TransactionInstruction {
  const [position] = positionPda(m.address, user, program);
  return new TransactionInstruction({
    programId: pk(program),
    keys: [meta(user, true, true), meta(pk(m.address), true), meta(position, true), meta(pk(m.quoteMint)), meta(userToken, true), meta(pk(m.vault), true), meta(pk(m.tokenProgram))],
    data: Buffer.from(encodeClaim()),
  });
}

// SPL token instructions the wrapped-SOL path needs

/** Create the ATA if it does not exist (the associated token program's CreateIdempotent, data [1]). */
export function createAtaIdempotentIx(payer: PublicKey, owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey = new PublicKey(TOKEN_PROGRAM)): TransactionInstruction {
  const ata = associatedTokenAddress(owner, mint, tokenProgram);
  return new TransactionInstruction({
    programId: new PublicKey(ASSOCIATED_TOKEN_PROGRAM),
    keys: [meta(payer, true, true), meta(ata, true), meta(owner), meta(mint), meta(SYSTEM), meta(tokenProgram)],
    data: Buffer.from([1]),
  });
}
/** SyncNative (token instruction 17): make a wrapped-SOL account's balance match the lamports it holds. */
export function syncNativeIx(account: PublicKey, tokenProgram: PublicKey = new PublicKey(TOKEN_PROGRAM)): TransactionInstruction {
  return new TransactionInstruction({ programId: tokenProgram, keys: [meta(account, true)], data: Buffer.from([17]) });
}
/** CloseAccount (token instruction 9): send the account's lamports, wrapped SOL included, to `destination`. */
export function closeAccountIx(account: PublicKey, destination: PublicKey, owner: PublicKey, tokenProgram: PublicKey = new PublicKey(TOKEN_PROGRAM)): TransactionInstruction {
  return new TransactionInstruction({ programId: tokenProgram, keys: [meta(account, true), meta(destination, true), meta(owner, false, true)], data: Buffer.from([9]) });
}

// ---- transaction plans ----

/**
 * The instructions for a stake. With wrapped SOL the user's ATA is created if missing, `amount` lamports are moved
 * into it and synced, then staked; when the ATA was created here it is closed again afterwards so no SOL is left
 * wrapped. With any other mint the user's ATA must already hold the amount.
 */
export function stakePlan(user: PublicKey, m: Pick<MarketAccount, 'address' | 'quoteMint' | 'tokenProgram' | 'vault'>, side: Side, amount: bigint, ataExists: boolean, program = CURVE_MARKET_PROGRAM): TransactionInstruction[] {
  const mint = new PublicKey(m.quoteMint), tokenProgram = new PublicKey(m.tokenProgram);
  const ata = associatedTokenAddress(user, mint, tokenProgram);
  const ixs: TransactionInstruction[] = [];
  if (!ataExists) ixs.push(createAtaIdempotentIx(user, user, mint, tokenProgram));
  if (isNativeMint(m.quoteMint)) {
    ixs.push(SystemProgram.transfer({ fromPubkey: user, toPubkey: ata, lamports: amount }), syncNativeIx(ata, tokenProgram));
  }
  ixs.push(stakeIx(user, m, ata, side, amount, program));
  if (isNativeMint(m.quoteMint) && !ataExists) ixs.push(closeAccountIx(ata, user, user, tokenProgram));
  return ixs;
}

/** The instructions for a claim: the ATA is created if missing, the payout lands in it, and wrapped SOL is unwrapped by closing the account. */
export function claimPlan(user: PublicKey, m: Pick<MarketAccount, 'address' | 'quoteMint' | 'tokenProgram' | 'vault'>, ataExists: boolean, program = CURVE_MARKET_PROGRAM): TransactionInstruction[] {
  const mint = new PublicKey(m.quoteMint), tokenProgram = new PublicKey(m.tokenProgram);
  const ata = associatedTokenAddress(user, mint, tokenProgram);
  const ixs: TransactionInstruction[] = [];
  if (!ataExists) ixs.push(createAtaIdempotentIx(user, user, mint, tokenProgram));
  ixs.push(claimIx(user, m, ata, program));
  if (isNativeMint(m.quoteMint)) ixs.push(closeAccountIx(ata, user, user, tokenProgram));
  return ixs;
}

// ---- reads (any JSON-RPC caller: the server's devnet fetch, a Connection, or a stub in tests) ----

export type RpcCall = <T>(method: string, params: unknown[]) => Promise<T>;
interface ProgramAccountRow { pubkey: string; account: { data: [string, string]; owner: string } }

const fromB64 = (s: string) => Uint8Array.from(Buffer.from(s, 'base64'));
const memcmp = (offset: number, key: string) => ({ memcmp: { offset, bytes: key } });

/** Every Market account, or those on one pool. */
export async function fetchMarkets(call: RpcCall, pool?: string, program = CURVE_MARKET_PROGRAM): Promise<MarketAccount[]> {
  const filters: unknown[] = [{ dataSize: MARKET_SIZE }, memcmp(0, bs58.encode(DISC.market))];
  if (pool) filters.push(memcmp(MARKET_POOL_OFFSET, pool));
  const rows = await call<ProgramAccountRow[]>('getProgramAccounts', [program, { encoding: 'base64', filters }]);
  const out: MarketAccount[] = [];
  for (const r of rows) { try { out.push(decodeMarket(fromB64(r.account.data[0]), r.pubkey)); } catch { /* not a market this build knows */ } }
  return out;
}

/** A user's positions, or just the one on `market`. */
export async function fetchPositions(call: RpcCall, user: string, market?: string, program = CURVE_MARKET_PROGRAM): Promise<PositionAccount[]> {
  const filters: unknown[] = [{ dataSize: POSITION_SIZE }, memcmp(0, bs58.encode(DISC.position)), memcmp(POSITION_OWNER_OFFSET, user)];
  if (market) filters.push(memcmp(POSITION_MARKET_OFFSET, market));
  const rows = await call<ProgramAccountRow[]>('getProgramAccounts', [program, { encoding: 'base64', filters }]);
  const out: PositionAccount[] = [];
  for (const r of rows) { try { out.push(decodePosition(fromB64(r.account.data[0]), r.pubkey)); } catch { /* skip */ } }
  return out;
}

/** One market by address, null when the account is missing. */
export async function fetchMarket(call: RpcCall, address: string): Promise<MarketAccount | null> {
  const res = await call<{ value: { data: [string, string] } | null }>('getAccountInfo', [address, { encoding: 'base64' }]);
  return res.value ? decodeMarket(fromB64(res.value.data[0]), address) : null;
}

/** Whether a token account exists, and its balance when it does. */
export async function tokenBalance(call: RpcCall, account: string): Promise<{ exists: boolean; amount: bigint }> {
  const res = await call<{ value: { data: [string, string] } | null }>('getAccountInfo', [account, { encoding: 'base64' }]);
  if (!res.value) return { exists: false, amount: 0n };
  return { exists: true, amount: tokenAccountAmount(fromB64(res.value.data[0])) };
}

/** Rows for the UI: open markets first by deadline, then resolved ones newest first. */
export function rankMarkets(rows: MarketAccount[]): MarketAccount[] {
  return [...rows].sort((a, b) => Number(a.state !== 'open') - Number(b.state !== 'open') || (a.state === 'open' ? a.deadlineTs - b.deadlineTs : (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0)));
}

/** A program error from a simulation or send, turned into the IDL's message. */
export function friendlyProgramError(message: string): string {
  const hex = /custom program error: 0x([0-9a-f]+)/i.exec(message);
  const code = hex ? parseInt(hex[1], 16) : (/"Custom":\s*(\d+)/.exec(message)?.[1] ? Number(/"Custom":\s*(\d+)/.exec(message)![1]) : null);
  if (code !== null && ERRORS[code]) return ERRORS[code];
  if (/insufficient|0x1\b|Attempt to debit|insufficient lamports/i.test(message)) return 'Not enough SOL in this wallet for the stake, the rent and the fee.';
  if (/Blockhash not found|block height exceeded/i.test(message)) return 'The transaction expired before it landed. Try again.';
  if (/not deployed|Program .* not found|unsupported program/i.test(message)) return 'The market program is not deployed on this cluster.';
  return message;
}
