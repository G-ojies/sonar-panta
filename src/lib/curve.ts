/**
 * Curve index: the Meteora DBC pools Sonar follows, how they are found, and what is kept for each.
 *
 * The DBC program is busy: measured 2 October 2026, about 11 transactions a second, a quarter of them failed,
 * and pool creations are 0.6 percent of the successful ones (6 in a sample of 1,000). Every creation in that sample
 * was paid by the creator's own wallet, direct to the program, under its own config, so there is no cheap address
 * whose signature list is a feed of launches, and a signature row says nothing about the instruction behind it.
 * Reading every transaction would cost about a megabyte a minute, which is not on for a host with 5 GB a month.
 *
 * So the index is sampled and bounded, and says so:
 *   1. Discovery. Each refresh reads the newest CURVE_SCAN_SIGNATURES signatures of the program (one call) and fetches
 *      the first CURVE_SCAN_TXS successful ones. A creation (EvtInitializePool) enters the index with its creator
 *      and time. A swap (EvtSwap2) enters its pool too, because a curve that is trading now is what a graduation
 *      market is about, and the print joins that pool's tape.
 *   2. Following. Every indexed pool's VirtualPool account is read in one getMultipleAccounts sweep per refresh
 *      (424 bytes each), which gives price, quote held, progress and status for all of them. A pool's config is
 *      immutable, so it is read once and cached for a month.
 *   3. Tapes. A pool's own signature list is only its own transactions, so a tape is cheap per pool: a few pools a
 *      refresh (the ones nearest graduation and the ones someone opened), bounded in signatures and transactions,
 *      plus an on-demand fill when a pool page is opened, inside a budget per ten minutes.
 *
 * The index holds at most CURVE_INDEX_MAX pools, ranked by when Sonar last saw them trade; migrated pools are kept
 * a day and quiet ones for CURVE_KEEP_HOURS. Pools listed in sonar:curve:pinned (the graduation markets, once the
 * program is wired) are never evicted. Any DBC pool can be asked for by address: it is read live, added, and followed.
 *
 * Budget per refresh with the defaults, measured in docs/CURVE.md: about 0.6 MB of JSON, a third of that on the
 * wire (the provider compresses), about 50 RPC calls paced to the plan's rate.
 */
import { rpc } from './chain-tape';
import {
  DBC_PROGRAM, QUOTE_MINTS, curveStatus, decodePoolConfig, decodeVirtualPool, eventsFromTx, fromRaw, priceFromSqrt, printsFromTx, progressPct,
  type CurvePrint, type CurveStatus, type DbcTx, type EvtInitializePool, type PoolConfigState, type VirtualPoolState,
} from './dbc';
import { store } from './store';

export const K = {
  index: 'sonar:curve:index:v1',
  tape: (pool: string) => `sonar:curve:tape:${pool}`,
  config: (config: string) => `sonar:curve:config:${config}`,
  pinned: 'sonar:curve:pinned',
  log: 'sonar:curve:log',
};

const env = (k: string, d: number) => { const n = Number(process.env[k]); return Number.isFinite(n) && n >= 0 ? n : d; };
/** Signatures of the program read per refresh (one call, about 230 bytes of JSON each). */
const SCAN_SIGNATURES = () => env('CURVE_SCAN_SIGNATURES', 100);
/** Successful transactions fetched and decoded per refresh (about 8.5 KB of JSON each). */
const SCAN_TXS = () => env('CURVE_SCAN_TXS', 30);
/** Pools whose tape is refreshed per scan, and the transactions each may cost. */
const TAPES_PER_SCAN = () => env('CURVE_TAPES_PER_SCAN', 4);
const TAPE_TXS = () => env('CURVE_TAPE_TXS', 10);
const TAPE_SIGNATURES = 25;
const TAPE_CAP = 200;
const INDEX_MAX = () => env('CURVE_INDEX_MAX', 150);
const KEEP_HOURS = () => env('CURVE_KEEP_HOURS', 36);
/** On-demand tape fills (a pool page opened) allowed per ten minutes in this process. */
const ONDEMAND_PER_10MIN = () => env('CURVE_ONDEMAND_PER_10MIN', 8);
const ONDEMAND_FRESH_S = 120;
/** A pool page re-reads the account when the index row is older than this; one read is shared by every poll inside the window. */
const ACCOUNT_FRESH_S = 60;
const liveRows = new Map<string, { at: number; fields: ReturnType<typeof poolFields> }>();
const TX_OPTS = { encoding: 'json', maxSupportedTransactionVersion: 1 };
const SLOT_S = 0.4;

/** When a pool started, from its activation point: exact for a timestamp config, about right for a slot config given the slot now. */
export function activationTime(state: Pick<VirtualPoolState, 'activation_point'>, cfg: Pick<PoolConfigSummary, 'activationType'>, slotNow: number | null, now: number): { at: number; from: 'activation' | 'slot' } | null {
  const point = Number(state.activation_point);
  if (!point) return null;
  if (cfg.activationType === 1) return { at: point, from: 'activation' };
  if (slotNow === null || point > slotNow) return null;
  return { at: Math.round(now - (slotNow - point) * SLOT_S), from: 'slot' };
}

export interface QuoteInfo { mint: string; symbol: string; decimals: number }

/** What the index keeps per pool: the account as last read, plus what the tape and the sample added. */
export interface CurvePool {
  address: string;
  config: string;
  creator: string;
  baseMint: string;
  quote: QuoteInfo;
  baseDecimals: number;
  /** When the pool was created: the creation event's block time; else the activation point, exact when it is a timestamp, about right when it is a slot (0.4 s each from the slot of the refresh). */
  createdAt: number | null;
  createdFrom: 'event' | 'activation' | 'slot' | null;
  firstSeenAt: number;
  lastSeenAt: number;
  /** How Sonar met it: its creation in the sample, a swap in the sample, or a request by address. */
  foundBy: 'creation' | 'swap' | 'request';
  status: CurveStatus;
  /** Quote per whole base token, display units. */
  price: number | null;
  sqrtPrice: string;
  /** Quote the pool holds now, display units and raw; the pool graduates when raw reaches thresholdRaw. */
  quoteRaised: number;
  quoteReserveRaw: string;
  threshold: number;
  thresholdRaw: string;
  progressPct: number | null;
  finishCurveAt: number | null;
  /** Prints Sonar has decoded for this pool (bounded; not the pool's lifetime count). */
  prints: number;
  /** Buys and sells among them, and the quote that moved in buys. */
  buys: number;
  sells: number;
  buyQuote: number;
  largest: { signature: string; side: 'buy' | 'sell'; quote: number; blockTime: number | null; wallet: string }[];
  /** Last five prints, newest first; the pool API carries the whole tape. */
  tape: CurvePrint[];
  /** When the account was last read. */
  updatedAt: number;
}

export interface CurveIndex {
  updatedAt: number;
  /** The newest program signature's slot at the last refresh. */
  slot: number | null;
  sample: { signatures: number; transactions: number; creations: number; prints: number; pools: number };
  pools: Record<string, CurvePool>;
  errors: string[];
  durationMs: number;
}

export interface CurveTape { ts: number; /** newest signature the tape holds, for `until` on the next fill */ cursor: string | null; prints: CurvePrint[]; complete: boolean }

interface SigRow { signature: string; slot: number; blockTime: number | null; err: unknown }
interface AccountInfo { data: [string, string]; owner: string } // base64

export interface PoolConfigSummary { quote: QuoteInfo; baseDecimals: number; thresholdRaw: string; migrationSqrtPrice: string; sqrtStartPrice: string; activationType: number; totalSupplyRaw: string }

// ---- configs and mints (immutable, cached) ----

const configMemo = new Map<string, PoolConfigSummary>();
const mintMemo = new Map<string, number>();

async function quoteInfo(mint: string): Promise<QuoteInfo> {
  const known = QUOTE_MINTS[mint];
  if (known) return { mint, ...known };
  let decimals = mintMemo.get(mint);
  if (decimals === undefined) {
    const key = `sonar:curve:mint:${mint}`;
    decimals = (await store().get<number>(key)) ?? undefined;
    if (decimals === undefined) {
      const info = await rpc<{ value: AccountInfo | null }>('getAccountInfo', [mint, { encoding: 'base64' }]);
      const data = info.value ? Buffer.from(info.value.data[0], 'base64') : null;
      decimals = data && data.length >= 45 ? data[44] : 0; // SPL mint layout: decimals at byte 44
      await store().set(key, decimals, 30 * 86400);
    }
    mintMemo.set(mint, decimals);
  }
  return { mint, symbol: mint.slice(0, 4), decimals };
}

function summarizeConfig(c: PoolConfigState, quote: QuoteInfo): PoolConfigSummary {
  return {
    quote, baseDecimals: c.token_decimal, thresholdRaw: String(c.migration_quote_threshold), migrationSqrtPrice: String(c.migration_sqrt_price),
    sqrtStartPrice: String(c.sqrt_start_price), activationType: c.activation_type, totalSupplyRaw: String(c.pre_migration_token_supply),
  };
}

/** The configs named, read once each: memory, then the store, then one getMultipleAccounts for the rest. */
async function loadConfigs(addresses: string[]): Promise<Map<string, PoolConfigSummary>> {
  const out = new Map<string, PoolConfigSummary>();
  const missing: string[] = [];
  for (const a of new Set(addresses)) {
    const m = configMemo.get(a) ?? (await store().get<PoolConfigSummary>(K.config(a))) ?? null;
    if (m) { configMemo.set(a, m); out.set(a, m); } else missing.push(a);
  }
  for (let i = 0; i < missing.length; i += 100) {
    const chunk = missing.slice(i, i + 100);
    const res = await rpc<{ value: (AccountInfo | null)[] }>('getMultipleAccounts', [chunk, { encoding: 'base64' }]);
    for (let j = 0; j < chunk.length; j++) {
      const v = res.value[j];
      if (!v) continue;
      try {
        const c = decodePoolConfig(Buffer.from(v.data[0], 'base64'));
        const s = summarizeConfig(c, await quoteInfo(c.quote_mint));
        configMemo.set(chunk[j], s); out.set(chunk[j], s);
        await store().set(K.config(chunk[j]), s, 30 * 86400);
      } catch { /* not a config, or a layout this IDL does not know: the pool is skipped */ }
    }
  }
  return out;
}

// ---- pool rows ----

/** The row's account-derived fields from a decoded VirtualPool and its config. */
export function poolFields(state: VirtualPoolState, cfg: PoolConfigSummary, now: number): Pick<CurvePool, 'status' | 'price' | 'sqrtPrice' | 'quoteRaised' | 'quoteReserveRaw' | 'threshold' | 'thresholdRaw' | 'progressPct' | 'finishCurveAt' | 'updatedAt'> {
  return {
    status: curveStatus(state), price: priceFromSqrt(state.sqrt_price, cfg.baseDecimals, cfg.quote.decimals), sqrtPrice: String(state.sqrt_price),
    quoteRaised: fromRaw(state.quote_reserve, cfg.quote.decimals), quoteReserveRaw: String(state.quote_reserve),
    threshold: fromRaw(cfg.thresholdRaw, cfg.quote.decimals), thresholdRaw: cfg.thresholdRaw,
    progressPct: progressPct(state.quote_reserve, cfg.thresholdRaw), finishCurveAt: state.finish_curve_timestamp ? Number(state.finish_curve_timestamp) : null, updatedAt: now,
  };
}

/** Tape-derived fields: counts, largest prints, the last five. */
export function tapeFields(prints: CurvePrint[], quoteDecimals: number): Pick<CurvePool, 'prints' | 'buys' | 'sells' | 'buyQuote' | 'largest' | 'tape'> {
  const q = (p: CurvePrint) => fromRaw(p.quoteRaw, quoteDecimals);
  const buys = prints.filter((p) => p.side === 'buy');
  const largest = [...prints].sort((a, b) => q(b) - q(a)).slice(0, 3).map((p) => ({ signature: p.signature, side: p.side, quote: q(p), blockTime: p.blockTime, wallet: p.wallet }));
  return { prints: prints.length, buys: buys.length, sells: prints.length - buys.length, buyQuote: buys.reduce((n, p) => n + q(p), 0), largest, tape: prints.slice(0, 5) };
}

/** Prints merged into a tape once each, newest first, capped. */
export function mergePrints(tape: CurveTape | null, fresh: CurvePrint[]): CurveTape {
  const base = tape ?? { ts: 0, cursor: null, prints: [], complete: false };
  const seen = new Set(base.prints.map((p) => p.id));
  const add = fresh.filter((p) => !seen.has(p.id));
  if (!add.length) return base;
  const prints = [...base.prints, ...add].sort((a, b) => (b.blockTime ?? 0) - (a.blockTime ?? 0)).slice(0, TAPE_CAP);
  return { ...base, prints };
}

/** Which pools to keep when the index is over its cap: pinned first, then the most recently active; quiet or long-migrated ones go. */
export function prune(pools: Record<string, CurvePool>, pinned: Set<string>, now: number, max = INDEX_MAX(), keepHours = KEEP_HOURS()): Record<string, CurvePool> {
  const rows = Object.values(pools).filter((p) => pinned.has(p.address) || (now - p.lastSeenAt < keepHours * 3600 && !(p.status === 'migrated' && now - p.updatedAt > 86400 && now - p.lastSeenAt > 86400)));
  rows.sort((a, b) => Number(pinned.has(b.address)) - Number(pinned.has(a.address)) || b.lastSeenAt - a.lastSeenAt);
  return Object.fromEntries(rows.slice(0, max).map((p) => [p.address, p]));
}

/** Pools whose tape is worth a refresh now: pinned, then nearest graduation among the trading ones, then the stalest. */
export function tapeCandidates(pools: CurvePool[], pinned: Set<string>, tapeAges: Map<string, number>, n = TAPES_PER_SCAN()): CurvePool[] {
  const score = (p: CurvePool) => (pinned.has(p.address) ? 1000 : 0) + (p.status === 'trading' ? (p.progressPct ?? 0) : -100) + Math.min(100, (tapeAges.get(p.address) ?? 1e9) / 3600);
  return [...pools].sort((a, b) => score(b) - score(a)).slice(0, n);
}

// ---- the refresh ----

async function readIndex(): Promise<CurveIndex | null> { return store().get<CurveIndex>(K.index); }

async function pinnedSet(): Promise<Set<string>> { return new Set((await store().get<string[]>(K.pinned)) ?? []); }

/** `n` rows spread evenly over the list, so a burst of bot swaps on one pool does not fill the whole sample. */
export function spread<T>(rows: T[], n: number): T[] {
  if (rows.length <= n) return rows;
  const step = rows.length / n;
  return Array.from({ length: n }, (_, i) => rows[Math.floor(i * step)]);
}

/** The newest signatures of the program, then `max` successful transactions spread across them, decoded. */
async function sampleProgram(max: number, errors: string[]): Promise<{ rows: SigRow[]; txs: { signature: string; tx: DbcTx }[] }> {
  const rows = await rpc<SigRow[]>('getSignaturesForAddress', [DBC_PROGRAM, { limit: SCAN_SIGNATURES() }]);
  const ok = spread(rows.filter((r) => !r.err), max);
  const txs: { signature: string; tx: DbcTx }[] = [];
  for (const r of ok) {
    try {
      const tx = await rpc<DbcTx | null>('getTransaction', [r.signature, TX_OPTS], { tries: 2 });
      if (tx) txs.push({ signature: r.signature, tx });
    } catch (e) { errors.push(`tx ${r.signature.slice(0, 8)}: ${(e as Error).message}`); }
  }
  return { rows, txs };
}

/** Read every pool's account in chunks; null for an address that is not a VirtualPool any more (closed) or never was. */
async function readPools(addresses: string[]): Promise<Map<string, VirtualPoolState | null>> {
  const out = new Map<string, VirtualPoolState | null>();
  for (let i = 0; i < addresses.length; i += 100) {
    const chunk = addresses.slice(i, i + 100);
    const res = await rpc<{ value: (AccountInfo | null)[] }>('getMultipleAccounts', [chunk, { encoding: 'base64' }]);
    chunk.forEach((a, j) => {
      const v = res.value[j];
      try { out.set(a, v && v.owner === DBC_PROGRAM ? decodeVirtualPool(Buffer.from(v.data[0], 'base64')) : null); } catch { out.set(a, null); }
    });
  }
  return out;
}

/**
 * Fill a pool's tape from its own signature list: the newest TAPE_SIGNATURES signatures, stopping at the cursor,
 * then at most `maxTxs` transactions. Returns the tape as stored.
 */
export async function fillTape(pool: string, maxTxs = TAPE_TXS()): Promise<{ tape: CurveTape; added: number }> {
  const s = store();
  const tape = await s.get<CurveTape>(K.tape(pool));
  const rows = await rpc<SigRow[]>('getSignaturesForAddress', [pool, { limit: TAPE_SIGNATURES, ...(tape?.cursor ? { until: tape.cursor } : {}) }]);
  const good = rows.filter((r) => !r.err);
  const ok = good.slice(0, maxTxs);
  const fresh: CurvePrint[] = [];
  for (const r of ok) {
    const tx = await rpc<DbcTx | null>('getTransaction', [r.signature, TX_OPTS], { tries: 2 });
    if (tx) fresh.push(...printsFromTx(r.signature, tx).filter((p) => p.pool === pool));
  }
  const next = mergePrints(tape, fresh);
  // complete when the list ran out before the page did (the whole history since the cursor was seen) and every row was fetched
  const complete = rows.length < TAPE_SIGNATURES && ok.length === good.length && (tape ? tape.complete : true);
  const out: CurveTape = { ...next, ts: Date.now() / 1000, cursor: rows[0]?.signature ?? tape?.cursor ?? null, complete };
  await s.set(K.tape(pool), out, 7 * 86400);
  return { tape: out, added: next.prints.length - (tape?.prints.length ?? 0) };
}

/** One refresh: sample the program, sweep the accounts, fill a few tapes, write the index. Never throws: errors are in the output. */
export async function refreshCurve(): Promise<CurveIndex> {
  const t0 = Date.now();
  const now = t0 / 1000;
  const s = store();
  const errors: string[] = [];
  const prev = (await readIndex())?.pools ?? {};
  const pools: Record<string, CurvePool> = { ...prev };
  const pinned = await pinnedSet();

  // 1. discovery
  let rows: SigRow[] = [], txs: { signature: string; tx: DbcTx }[] = [];
  try { ({ rows, txs } = await sampleProgram(SCAN_TXS(), errors)); } catch (e) { errors.push(`sample: ${(e as Error).message}`); }
  const created = new Map<string, { ev: EvtInitializePool; blockTime: number | null }>();
  const sampled = new Map<string, CurvePrint[]>();
  for (const { signature, tx } of txs) {
    for (const e of eventsFromTx(tx)) if (e.name === 'EvtInitializePool') { const ev = e.data as unknown as EvtInitializePool; created.set(ev.pool, { ev, blockTime: tx.blockTime }); }
    for (const p of printsFromTx(signature, tx)) sampled.set(p.pool, [...(sampled.get(p.pool) ?? []), p]);
  }
  const seenNow = new Set([...created.keys(), ...sampled.keys()]);
  const addresses = [...new Set([...Object.keys(pools), ...seenNow, ...pinned])];

  // 2. the sweep
  let states = new Map<string, VirtualPoolState | null>();
  try { states = await readPools(addresses); } catch (e) { errors.push(`accounts: ${(e as Error).message}`); }
  const configs = await loadConfigs([...states.values()].filter((v): v is VirtualPoolState => !!v).map((v) => v.config)).catch((e) => { errors.push(`configs: ${(e as Error).message}`); return new Map<string, PoolConfigSummary>(); });
  for (const a of addresses) {
    const state = states.get(a);
    if (state === undefined) continue; // the sweep failed: the row stands as it was
    if (state === null) { if (!pinned.has(a)) delete pools[a]; continue; }
    const cfg = configs.get(state.config);
    if (!cfg) continue;
    const old = pools[a];
    const c = created.get(a);
    const activation = activationTime(state, cfg, rows[0]?.slot ?? null, now);
    const row: CurvePool = {
      address: a, config: state.config, creator: state.creator, baseMint: state.base_mint, quote: cfg.quote, baseDecimals: cfg.baseDecimals,
      createdAt: c?.blockTime ?? old?.createdAt ?? activation?.at ?? null, createdFrom: c ? 'event' : old?.createdFrom ?? activation?.from ?? null,
      firstSeenAt: old?.firstSeenAt ?? now, lastSeenAt: seenNow.has(a) ? now : old?.lastSeenAt ?? now,
      foundBy: old?.foundBy ?? (c ? 'creation' : sampled.has(a) ? 'swap' : 'request'),
      ...poolFields(state, cfg, now),
      prints: 0, buys: 0, sells: 0, buyQuote: 0, largest: [], tape: [],
    };
    // sampled prints join the stored tape; the tape fields are recomputed from it
    const sp = sampled.get(a);
    let tape = await s.get<CurveTape>(K.tape(a));
    if (sp?.length) { const next = mergePrints(tape, sp); if (next !== tape) { await s.set(K.tape(a), next, 7 * 86400); tape = next; } }
    Object.assign(row, tapeFields(tape?.prints ?? [], cfg.quote.decimals));
    pools[a] = row;
  }

  // 3. a few tapes
  const kept = prune(pools, pinned, now);
  const ages = new Map<string, number>();
  for (const a of Object.keys(kept)) { const t = await s.get<CurveTape>(K.tape(a)); if (t) ages.set(a, now - t.ts); }
  let tapePrints = 0;
  for (const p of tapeCandidates(Object.values(kept), pinned, ages)) {
    try {
      const { tape: t, added } = await fillTape(p.address);
      tapePrints += added;
      Object.assign(kept[p.address], tapeFields(t.prints, p.quote.decimals));
      if (added && t.prints[0]) kept[p.address].lastSeenAt = Math.max(kept[p.address].lastSeenAt, t.prints[0].blockTime ?? 0);
    } catch (e) { errors.push(`tape ${p.address.slice(0, 8)}: ${(e as Error).message}`); }
  }

  const out: CurveIndex = {
    updatedAt: now, slot: rows[0]?.slot ?? null,
    sample: { signatures: rows.length, transactions: txs.length, creations: created.size, prints: [...sampled.values()].reduce((n, v) => n + v.length, 0) + tapePrints, pools: seenNow.size },
    pools: kept, errors, durationMs: Date.now() - t0,
  };
  await s.set(K.index, out);
  indexCache = null;
  await s.lpush(K.log, { ts: now, ...out.sample, kept: Object.keys(kept).length, errors: errors.length, durationMs: out.durationMs }, 50);
  return out;
}

/** On unless SONAR_CURVE=off: the tick then skips the DBC sample and the /curve page says the index has not run. */
export const curveEnabled = (env: Record<string, string | undefined> = process.env) => env.SONAR_CURVE !== 'off';

/** The refresh as the tick runs it: after the Panta work, never throwing, so Curve can never break the radar. */
export async function curveTick(): Promise<CurveIndex | null> {
  if (!curveEnabled()) return null;
  try { return await refreshCurve(); } catch (e) { console.error('curve refresh failed', (e as Error).message); return null; }
}

// ---- reads ----

const READ_TTL_MS = 30_000;
let indexCache: { at: number; value: CurveIndex | null } | null = null;

export async function readCurve(): Promise<CurveIndex | null> {
  if (indexCache && Date.now() - indexCache.at < READ_TTL_MS) return indexCache.value;
  const value = await readIndex();
  indexCache = { at: Date.now(), value };
  return value;
}

export async function readTape(pool: string): Promise<CurveTape | null> { return store().get<CurveTape>(K.tape(pool)); }

export type CurveLogRow = { ts: number; signatures: number; transactions: number; creations: number; prints: number; pools: number; kept: number; errors: number; durationMs: number };
export async function readCurveLog(): Promise<CurveLogRow[]> { return store().lrange<CurveLogRow>(K.log, 0, 20); }

/** Rows in list order: trading pools nearest graduation first, then complete, then migrated; ties by last activity. */
export function rankPools(pools: CurvePool[]): CurvePool[] {
  const bucket = (p: CurvePool) => (p.status === 'trading' ? 0 : p.status === 'complete' ? 1 : 2);
  return [...pools].sort((a, b) => bucket(a) - bucket(b) || (b.progressPct ?? 0) - (a.progressPct ?? 0) || b.lastSeenAt - a.lastSeenAt);
}

// on-demand fills: a token bucket per process
let demand: { windowStart: number; used: number } = { windowStart: 0, used: 0 };
function takeDemand(now = Date.now()): boolean {
  if (now - demand.windowStart > 600_000) demand = { windowStart: now, used: 0 };
  if (demand.used >= ONDEMAND_PER_10MIN()) return false;
  demand.used++;
  return true;
}
/** For tests. */
export function resetDemand() { demand = { windowStart: 0, used: 0 }; }

/**
 * One pool with its tape. A pool the index knows is served from it; any other DBC pool address is read live (one
 * account, one config), added to the index so the next refresh follows it, and gets a tape if the on-demand budget
 * allows. `fresh` says whether the tape was filled on this call.
 */
export async function readPool(address: string): Promise<{ pool: CurvePool; tape: CurveTape | null; fresh: boolean } | null> {
  const s = store();
  const now = Date.now() / 1000;
  const idx = await readCurve();
  let pool = idx?.pools[address] ? { ...idx.pools[address] } : null;
  if (pool && now - pool.updatedAt > ACCOUNT_FRESH_S) {
    // the row is from the last refresh and a curve can fill in minutes: read the account again, once a minute at most
    const memo = liveRows.get(address);
    if (memo && now - memo.at < ACCOUNT_FRESH_S) Object.assign(pool, memo.fields);
    else {
      try {
        const state = (await readPools([address])).get(address);
        const cfg = state ? (await loadConfigs([state.config])).get(state.config) : undefined;
        if (state && cfg) { const fields = poolFields(state, cfg, now); liveRows.set(address, { at: now, fields }); Object.assign(pool, fields); }
      } catch { /* the row from the refresh stands */ }
    }
  }
  if (!pool) {
    const states = await readPools([address]);
    const state = states.get(address);
    if (!state) return null;
    const cfg = (await loadConfigs([state.config])).get(state.config);
    if (!cfg) return null;
    const activation = activationTime(state, cfg, idx?.slot ?? null, idx?.updatedAt ?? now);
    pool = {
      address, config: state.config, creator: state.creator, baseMint: state.base_mint, quote: cfg.quote, baseDecimals: cfg.baseDecimals,
      createdAt: activation?.at ?? null, createdFrom: activation?.from ?? null, firstSeenAt: now, lastSeenAt: now, foundBy: 'request',
      ...poolFields(state, cfg, now), prints: 0, buys: 0, sells: 0, buyQuote: 0, largest: [], tape: [],
    };
    // added to the stored index outside the read cache, so the next refresh sweeps it; the list page shows it after that
    const live = await readIndex();
    if (live && !live.pools[address] && Object.keys(live.pools).length < INDEX_MAX() + 20) { live.pools[address] = pool; await s.set(K.index, live); indexCache = null; }
  }
  let tape = await readTape(address);
  let fresh = false;
  if ((!tape || now - tape.ts > ONDEMAND_FRESH_S) && pool.status !== 'migrated' && takeDemand()) {
    try { tape = (await fillTape(address)).tape; fresh = true; } catch { /* the stored tape, if any, stands */ }
  }
  if (tape) Object.assign(pool, tapeFields(tape.prints, pool.quote.decimals));
  return { pool, tape, fresh };
}
