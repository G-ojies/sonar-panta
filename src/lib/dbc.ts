/**
 * Meteora Dynamic Bonding Curve (DBC): the program's events and accounts, decoded from its IDL.
 *
 * The program is dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN on mainnet and devnet. Its IDL (src/lib/dbc-idl.json,
 * Anchor 0.30 format, program version 0.2.1) is the only source of truth here: every discriminator and field layout
 * is read from it at load time, so there is no SDK dependency and nothing hand-typed to drift.
 *
 * Events. The program emits with Anchor's `emit_cpi!`, not `emit!`: each event is a self-CPI to the program with the
 * event authority as the one account, and the instruction data is the 8-byte event tag (sha256("anchor:event")[..8])
 * followed by the event's own 8-byte discriminator and its Borsh body. So the tape is read from a transaction's
 * `meta.innerInstructions`, not from `Program data:` log lines (those are handled too, for a program built with
 * `emit!`). A `swap2` instruction emits both the legacy EvtSwap and EvtSwap2; only EvtSwap2 is turned into a print.
 *
 * Accounts. VirtualPool and PoolConfig are bytemuck (repr(C)) accounts. Their fields are laid out with explicit
 * padding so that no implicit alignment padding exists, which is what lets the same sequential reader decode them;
 * the sizes computed from the IDL (VirtualPool 424 bytes, PoolConfig 1,048 bytes, both counting the discriminator)
 * are checked against live accounts in the tests and in `decodeVirtualPool` / `decodePoolConfig`.
 *
 * Price. `sqrt_price` is the square root of the price in Q64.64 fixed point, in raw units (quote lamports per base
 * lamport). So price_raw = (sqrt_price / 2^64)^2 and the display price, quote per whole base token, is
 * price_raw * 10^(base_decimals - quote_decimals). Base decimals come from the config (`token_decimal`); quote
 * decimals from the quote mint (SOL 9, USDC 6).
 *
 * Progress. A curve graduates when the quote the pool holds reaches the config's `migration_quote_threshold`, so
 * progress = quote_reserve / migration_quote_threshold, capped at 100 percent. The pool is complete once
 * `finish_curve_timestamp` is set (the last swap filled the curve) and migrated once `is_migrated` is set (the
 * DAMM pool exists). Both read straight from the account, which is what lets a graduation market resolve with no oracle.
 */
import bs58 from 'bs58';
import idl from './dbc-idl.json';

export const DBC_PROGRAM = 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN';
/** Anchor's event instruction tag: the first 8 bytes of sha256("anchor:event"). */
export const EVENT_IX_TAG = Buffer.from([228, 69, 165, 46, 81, 203, 154, 29]);
export const VIRTUAL_POOL_SIZE = 424;
export const POOL_CONFIG_SIZE = 1048;

/** Well-known quote mints and their decimals; anything else is read from the mint account. */
export const QUOTE_MINTS: Record<string, { symbol: string; decimals: number }> = {
  So11111111111111111111111111111111111111112: { symbol: 'SOL', decimals: 9 },
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: 'USDC', decimals: 6 },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: 'USDT', decimals: 6 },
};

// ---- IDL-driven Borsh reader ----

type IdlType = string | { defined: { name: string } | string } | { array: [IdlType, number] } | { vec: IdlType } | { option: IdlType };
interface IdlField { name: string; type: IdlType }
interface IdlTypeDef { name: string; type: { kind: 'struct'; fields: IdlField[] } | { kind: 'enum'; variants: { name: string }[] } }
interface Idl { events: { name: string; discriminator: number[] }[]; accounts: { name: string; discriminator: number[] }[]; types: IdlTypeDef[] }

const IDL = idl as unknown as Idl;
const TYPES = new Map(IDL.types.map((t) => [t.name, t]));
const EVENTS = new Map(IDL.events.map((e) => [e.discriminator.join(','), e.name]));
const ACCOUNTS = new Map(IDL.accounts.map((a) => [a.name, Buffer.from(a.discriminator)]));

export type Decoded = Record<string, unknown>;

class Reader {
  off: number;
  constructor(public buf: Buffer, off = 0) { this.off = off; }
  private need(n: number) { if (this.off + n > this.buf.length) throw new Error(`dbc: short buffer at ${this.off}+${n} of ${this.buf.length}`); }
  u8() { this.need(1); return this.buf[this.off++]; }
  u16() { this.need(2); const v = this.buf.readUInt16LE(this.off); this.off += 2; return v; }
  u32() { this.need(4); const v = this.buf.readUInt32LE(this.off); this.off += 4; return v; }
  u64() { this.need(8); const v = this.buf.readBigUInt64LE(this.off); this.off += 8; return v; }
  i64() { this.need(8); const v = this.buf.readBigInt64LE(this.off); this.off += 8; return v; }
  u128() { const lo = this.u64(); const hi = this.u64(); return (hi << 64n) | lo; }
  pubkey() { this.need(32); const v = bs58.encode(this.buf.subarray(this.off, this.off + 32)); this.off += 32; return v; }
}

function readType(r: Reader, t: IdlType): unknown {
  if (typeof t === 'string') {
    switch (t) {
      case 'u8': return r.u8();
      case 'u16': return r.u16();
      case 'u32': return r.u32();
      case 'u64': return r.u64();
      case 'i64': return r.i64();
      case 'u128': return r.u128();
      case 'bool': return r.u8() !== 0;
      case 'pubkey': return r.pubkey();
      default: throw new Error(`dbc: unsupported IDL type ${t}`);
    }
  }
  if ('defined' in t) return readDefined(r, typeof t.defined === 'string' ? t.defined : t.defined.name);
  if ('array' in t) { const [inner, n] = t.array; return Array.from({ length: n }, () => readType(r, inner)); }
  if ('vec' in t) { const n = r.u32(); return Array.from({ length: n }, () => readType(r, t.vec)); }
  if ('option' in t) return r.u8() === 0 ? null : readType(r, t.option);
  throw new Error(`dbc: unsupported IDL type ${JSON.stringify(t)}`);
}

function readDefined(r: Reader, name: string): unknown {
  const def = TYPES.get(name);
  if (!def) throw new Error(`dbc: unknown IDL type ${name}`);
  if (def.type.kind === 'enum') { const i = r.u8(); return def.type.variants[i]?.name ?? i; }
  const out: Decoded = {};
  for (const f of def.type.fields) out[f.name] = readType(r, f.type);
  return out;
}

/** Bytes a type occupies, for types with no vec or option (the accounts). */
export function sizeOf(t: IdlType): number {
  if (typeof t === 'string') return ({ u8: 1, u16: 2, u32: 4, u64: 8, i64: 8, u128: 16, bool: 1, pubkey: 32 } as Record<string, number>)[t] ?? (() => { throw new Error(`dbc: no size for ${t}`); })();
  if ('defined' in t) {
    const def = TYPES.get(typeof t.defined === 'string' ? t.defined : t.defined.name);
    if (!def) throw new Error('dbc: unknown type');
    if (def.type.kind === 'enum') return 1;
    return def.type.fields.reduce((n, f) => n + sizeOf(f.type), 0);
  }
  if ('array' in t) return sizeOf(t.array[0]) * t.array[1];
  throw new Error('dbc: dynamic type has no fixed size');
}

/**
 * Byte offset of a field inside a type with a fixed layout, by dotted path ("pool_state.quote_reserve"). Account data
 * offsets are this plus 8 for the discriminator. This is what a program that reads the pool account needs.
 */
export function offsetOf(typeName: string, path: string): number {
  let off = 0;
  let name = typeName;
  for (const part of path.split('.')) {
    const def = TYPES.get(name);
    if (!def || def.type.kind !== 'struct') throw new Error(`dbc: ${name} is not a struct`);
    const i = def.type.fields.findIndex((f) => f.name === part);
    if (i < 0) throw new Error(`dbc: ${name} has no field ${part}`);
    off += def.type.fields.slice(0, i).reduce((n, f) => n + sizeOf(f.type), 0);
    const t = def.type.fields[i].type;
    name = typeof t === 'object' && 'defined' in t ? (typeof t.defined === 'string' ? t.defined : t.defined.name) : '';
  }
  return off;
}

/** Decode an IDL type by name from `buf` at `offset`. Exposed for tests and fixtures. */
export function decodeType(name: string, buf: Buffer, offset = 0): Decoded {
  return readDefined(new Reader(buf, offset), name) as Decoded;
}

// ---- events ----

export interface EvtInitializePool { pool: string; config: string; creator: string; base_mint: string; pool_type: number; activation_point: bigint }
export interface EvtSwap2 {
  pool: string; config: string; trade_direction: number; has_referral: boolean;
  swap_parameters: { amount_0: bigint; amount_1: bigint; swap_mode: number };
  swap_result: { included_fee_input_amount: bigint; excluded_fee_input_amount: bigint; amount_left: bigint; output_amount: bigint; next_sqrt_price: bigint; trading_fee: bigint; protocol_fee: bigint; referral_fee: bigint };
  quote_reserve_amount: bigint; migration_threshold: bigint; current_timestamp: bigint;
}
export interface EvtSwap {
  pool: string; config: string; trade_direction: number; has_referral: boolean;
  params: { amount_in: bigint; minimum_amount_out: bigint };
  swap_result: { actual_input_amount: bigint; output_amount: bigint; next_sqrt_price: bigint; trading_fee: bigint; protocol_fee: bigint; referral_fee: bigint };
  amount_in: bigint; current_timestamp: bigint;
}
export interface EvtCurveComplete { pool: string; config: string; base_reserve: bigint; quote_reserve: bigint }

export interface DbcEvent { name: string; data: Decoded }

/** The DBC event in `bytes` (event discriminator first, no instruction tag), or null when it is not one. */
export function decodeEvent(bytes: Uint8Array): DbcEvent | null {
  if (bytes.length < 8) return null;
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const name = EVENTS.get([...buf.subarray(0, 8)].join(','));
  if (!name) return null;
  try { return { name, data: decodeType(name, buf, 8) }; } catch { return null; }
}

/** A transaction as getTransaction returns it with encoding json, reduced to what the decoder reads. */
export interface DbcTx {
  blockTime: number | null;
  meta: {
    err: unknown;
    logMessages?: string[];
    innerInstructions?: { index: number; instructions: { programIdIndex: number; accounts: number[]; data: string }[] }[];
    loadedAddresses?: { writable?: string[]; readonly?: string[] };
  } | null;
  transaction: { message: { accountKeys: (string | { pubkey: string })[]; instructions?: { programIdIndex: number; accounts: number[]; data: string }[] } };
}

/** Every account the transaction loaded, static keys first, then the lookup-table ones in the order the node reports them. */
export function txKeys(tx: DbcTx): string[] {
  return [
    ...tx.transaction.message.accountKeys.map((k) => (typeof k === 'string' ? k : k.pubkey)),
    ...(tx.meta?.loadedAddresses?.writable ?? []), ...(tx.meta?.loadedAddresses?.readonly ?? []),
  ];
}

/** Every DBC event in a confirmed transaction, in execution order: the emit_cpi inner instructions, then any `Program data:` lines. */
export function eventsFromTx(tx: DbcTx, program = DBC_PROGRAM): DbcEvent[] {
  if (!tx.meta || tx.meta.err) return [];
  const keys = txKeys(tx);
  const out: DbcEvent[] = [];
  for (const group of tx.meta.innerInstructions ?? []) {
    for (const ins of group.instructions) {
      if (keys[ins.programIdIndex] !== program) continue;
      let data: Uint8Array;
      try { data = bs58.decode(ins.data); } catch { continue; }
      if (data.length < 16 || !Buffer.from(data.subarray(0, 8)).equals(EVENT_IX_TAG)) continue;
      const ev = decodeEvent(data.subarray(8));
      if (ev) out.push(ev);
    }
  }
  for (const line of tx.meta.logMessages ?? []) {
    if (!line.startsWith('Program data: ')) continue;
    const ev = decodeEvent(Buffer.from(line.slice('Program data: '.length), 'base64'));
    if (ev) out.push(ev);
  }
  return out;
}

// ---- prints ----

/** One swap on a curve, as the tape shows it. Amounts are raw units (lamports of quote, base units of base). */
export interface CurvePrint {
  id: string;
  signature: string;
  blockTime: number | null;
  pool: string;
  /** The fee payer: the trader for a direct swap, the router's payer when a bot or aggregator sent it. */
  wallet: string;
  side: 'buy' | 'sell';
  /** Quote that moved: paid in on a buy (fee included), received on a sell. */
  quoteRaw: string;
  /** Base that moved: received on a buy, sold on a sell. */
  baseRaw: string;
  tradingFeeRaw: string;
  /** sqrt price after the swap, Q64.64, as a decimal string. */
  sqrtPriceAfter: string;
  /** Quote the pool held after the swap, and the threshold it graduates at, both raw. */
  quoteReserveAfter: string;
  migrationThreshold: string;
  source: 'chain';
}

/** TradeDirection in the program: 0 is base to quote (a sell), 1 is quote to base (a buy). */
export const isBuy = (tradeDirection: number) => tradeDirection === 1;

/** The swaps in one confirmed transaction as prints. A swap2 emits EvtSwap too; that duplicate is dropped. */
export function printsFromTx(signature: string, tx: DbcTx): CurvePrint[] {
  const events = eventsFromTx(tx);
  const wallet = txKeys(tx)[0] ?? '';
  const out: CurvePrint[] = [];
  const push = (p: Omit<CurvePrint, 'id' | 'signature' | 'blockTime' | 'wallet' | 'source'>) =>
    out.push({ id: out.length ? `${signature}:${out.length}` : signature, signature, blockTime: tx.blockTime, wallet, source: 'chain', ...p });
  const hasSwap2 = events.some((e) => e.name === 'EvtSwap2');
  for (const e of events) {
    if (e.name === 'EvtSwap2') {
      const d = e.data as unknown as EvtSwap2;
      const buy = isBuy(d.trade_direction);
      push({
        pool: d.pool, side: buy ? 'buy' : 'sell',
        quoteRaw: String(buy ? d.swap_result.included_fee_input_amount : d.swap_result.output_amount),
        baseRaw: String(buy ? d.swap_result.output_amount : d.swap_result.included_fee_input_amount),
        tradingFeeRaw: String(d.swap_result.trading_fee), sqrtPriceAfter: String(d.swap_result.next_sqrt_price),
        quoteReserveAfter: String(d.quote_reserve_amount), migrationThreshold: String(d.migration_threshold),
      });
    } else if (e.name === 'EvtSwap' && !hasSwap2) {
      // a legacy swap instruction: no reserve or threshold in the event, so those are left empty and the account fills them in
      const d = e.data as unknown as EvtSwap;
      const buy = isBuy(d.trade_direction);
      push({
        pool: d.pool, side: buy ? 'buy' : 'sell',
        quoteRaw: String(buy ? d.swap_result.actual_input_amount : d.swap_result.output_amount),
        baseRaw: String(buy ? d.swap_result.output_amount : d.swap_result.actual_input_amount),
        tradingFeeRaw: String(d.swap_result.trading_fee), sqrtPriceAfter: String(d.swap_result.next_sqrt_price),
        quoteReserveAfter: '', migrationThreshold: '',
      });
    }
  }
  return out;
}

// ---- accounts ----

export interface VirtualPoolState {
  config: string; creator: string; base_mint: string; base_vault: string; quote_vault: string;
  base_reserve: bigint; quote_reserve: bigint; sqrt_price: bigint; activation_point: bigint;
  pool_type: number; is_migrated: number; migration_progress: number; finish_curve_timestamp: bigint; has_swap: number;
  metrics: { total_protocol_base_fee: bigint; total_protocol_quote_fee: bigint; total_trading_base_fee: bigint; total_trading_quote_fee: bigint };
  [k: string]: unknown;
}
export interface PoolConfigState {
  quote_mint: string; fee_claimer: string; token_decimal: number; token_type: number; activation_type: number;
  migration_quote_threshold: bigint; migration_base_threshold: bigint; migration_sqrt_price: bigint; sqrt_start_price: bigint;
  pre_migration_token_supply: bigint; post_migration_token_supply: bigint; curve: { sqrt_price: bigint; liquidity: bigint }[];
  [k: string]: unknown;
}

function checkAccount(name: string, data: Buffer, size: number) {
  const disc = ACCOUNTS.get(name)!;
  if (data.length < 8 || !data.subarray(0, 8).equals(disc)) throw new Error(`dbc: not a ${name} account`);
  if (data.length < size) throw new Error(`dbc: ${name} account is ${data.length} bytes, expected ${size}`);
}

/** The pool state inside a VirtualPool account (discriminator checked). */
export function decodeVirtualPool(data: Buffer): VirtualPoolState {
  checkAccount('VirtualPool', data, VIRTUAL_POOL_SIZE);
  return (decodeType('VirtualPool', data, 8) as { pool_state: VirtualPoolState }).pool_state;
}

export function decodePoolConfig(data: Buffer): PoolConfigState {
  checkAccount('PoolConfig', data, POOL_CONFIG_SIZE);
  return decodeType('PoolConfig', data, 8) as unknown as PoolConfigState;
}

export const accountDiscriminator = (name: string) => ACCOUNTS.get(name)!;

// ---- math ----
// The arithmetic lives in dbc-math.ts so the browser can import it without the IDL; re-exported here for the server.
export { curveStatus, fromRaw, priceFromSqrt, progressPct, type CurveStatus } from './dbc-math';
