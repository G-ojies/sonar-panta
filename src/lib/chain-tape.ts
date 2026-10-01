/**
 * Chain tape: the prints Panta's trades endpoint does not return, read from the program's own log.
 *
 * Every primary order the Panta program executes writes one plain-text line to the transaction log:
 *   "Primary Order (USDC): side=No, amount=1727203, yes_price=499344245, no_price=500655755, minted=3440032"
 *   "Primary Order: side=Yes, lamports=245272000, yes_price=549137856, no_price=450862144, minted=439326839"
 * so a market's full tape, with the exact YES price after each print, can be rebuilt from
 * getSignaturesForAddress(market) + getTransaction(sig) with no IDL. GET /markets/{id}/trades/ is empty
 * for most resolved markets and for every graduated one (feedback item 17); this fills the gap.
 */
import { PROVIDER_NAMES, chainEndpoints, hostOf, isProvider, isRefusal, markRefused, paceWait, pickEndpoint, type Endpoint } from './chain-endpoints';
import { PANTA_PROGRAM_MAINNET } from './panta-public';
import type { ChainHealth, Trade } from './types';

const ORDER = /Primary Order(?: \((\w+)\))?: side=(Yes|No), (?:lamports|amount)=(\d+), yes_price=(\d+), no_price=(\d+), minted=(\d+)/;

export interface ChainTapeCache { ts: number; trades: Trade[]; signatures: number; complete: boolean }

interface SigInfo { signature: string; blockTime: number | null; err: unknown }
export interface Tx { blockTime: number | null; meta: { err: unknown; logMessages?: string[]; loadedAddresses?: { writable?: string[]; readonly?: string[] } } | null; transaction: { message: { accountKeys: (string | { pubkey: string })[] } } }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface RpcOptions { tries?: number; /** Send this call to the endpoint that keeps deep ledger history (see historyEndpoint). */ history?: boolean; /** Send it to exactly this endpoint. */ at?: Endpoint }

/**
 * One JSON-RPC call on the chain endpoint: RPC Fast or Solami when a key is set, the public endpoint otherwise (see
 * chain-endpoints.ts). `history: true` routes it to the endpoint that can answer months back.
 */
export async function rpc<T>(method: string, params: unknown[], opts: RpcOptions = {}): Promise<T> {
  const tries = opts.tries ?? 5;
  for (let i = 0; ; i++) {
    const ep = opts.at ?? (opts.history ? await historyEndpoint() : pickEndpoint('http'));
    const wait = paceWait(ep.provider); // stay inside the plan's request rate instead of bursting into it
    if (wait) await sleep(wait);
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 30_000);
    try {
      const res = await fetch(ep.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: ctl.signal, cache: 'no-store' });
      // the provider refused the key (revoked, empty balance, wrong type): a retry changes nothing, so the fallback endpoint takes this call
      if (isProvider(ep.provider) && isRefusal('http', res.status)) {
        if (opts.at) throw new Error(`rpc ${res.status}`);
        if (ep.url === chainEndpoints().http.url) markRefused('http');
        else noHistory.set(ep.url, Date.now() + HISTORY_PROBE_MS); // the history endpoint refused: the plain one answers history for a while
        i--; continue;
      }
      if (res.status === 429 || res.status >= 500) throw new Error(`rpc ${res.status}`);
      const j = (await res.json()) as { result?: T; error?: { message: string } };
      if (j.error) throw new Error(j.error.message);
      return j.result as T;
    } catch (e) {
      if (i >= tries - 1) throw e;
      await sleep(1500 * 2 ** i + Math.random() * 500); // back off on 429 and hiccups (a public RPC throttles shared hosts)
    } finally { clearTimeout(t); }
  }
}

/**
 * Which endpoints keep deep history, learned by asking. A node that holds only recent ledger answers
 * getSignaturesForAddress with the signatures it has and no error, so an empty or short list is the only signal.
 * The probe lists the Panta program's signatures: an archive returns a full page or reaches back more than a week.
 * Asked once an hour per endpoint, and corrected sooner by a rebuild that comes up short (fetchChainTape).
 */
const HISTORY_PROBE_MS = 60 * 60_000;
const DEEP_S = 7 * 86400;
const keepsHistory = new Map<string, { until: number; yes: boolean }>();
/** Endpoints known to lack history, until the time given. */
const noHistory = new Map<string, number>();

async function probeHistory(ep: Endpoint, now = Date.now()): Promise<boolean> {
  const known = keepsHistory.get(ep.url);
  if (known && now < known.until) return known.yes;
  let yes = true; // on any failure assume history is there, which is how the app behaved before the probe existed
  try {
    const rows = await rpc<{ blockTime: number | null }[]>('getSignaturesForAddress', [PANTA_PROGRAM_MAINNET, { limit: 1000 }], { at: ep, tries: 2 });
    const oldest = rows[rows.length - 1]?.blockTime ?? null;
    yes = rows.length >= 1000 || (oldest !== null && oldest < now / 1000 - DEEP_S);
  } catch { /* keep yes */ }
  keepsHistory.set(ep.url, { until: now + HISTORY_PROBE_MS, yes });
  return yes;
}

/** The endpoint for reads that go months back: the provider when it keeps history, otherwise the history endpoint. */
export async function historyEndpoint(now = Date.now()): Promise<Endpoint> {
  const ep = chainEndpoints();
  const live = pickEndpoint('http', ep, now);
  if (!isProvider(live.provider)) return live;
  if ((noHistory.get(live.url) ?? 0) > now || !(await probeHistory(live, now))) {
    const h = ep.history;
    return (noHistory.get(h.url) ?? 0) > now ? ep.fallback!.http : h; // the history endpoint itself refused: plain
  }
  return live;
}

/** For tests: forget what the probes learned. */
export function clearHistoryProbe() { keepsHistory.clear(); noHistory.clear(); }

/** The history path as health reports it, from what is known now; the first rebuild after boot settles it. */
export function historyHealth(now = Date.now()): ChainHealth['history'] {
  const ep = chainEndpoints();
  const live = pickEndpoint('http', ep, now);
  const known = keepsHistory.get(live.url);
  const short = isProvider(live.provider) && ((noHistory.get(live.url) ?? 0) > now || (known ? !known.yes : false));
  const used = !short ? live : (noHistory.get(ep.history.url) ?? 0) > now ? ep.fallback!.http : ep.history;
  return {
    provider: used.provider, host: hostOf(used.url), probed: isProvider(live.provider) ? known !== undefined || (noHistory.get(live.url) ?? 0) > now : null,
    note: short ? `${PROVIDER_NAMES[live.provider]} keeps only recent ledger; tape rebuilds read history over ${PROVIDER_NAMES[used.provider]}` : null,
  };
}

/** One parsed order line, or null when the line is something else. */
export function parseOrderLog(line: string): { quote: 'USDC' | 'SOL'; side: 'yes' | 'no'; amountRaw: number; yesPrice: number; shares: number } | null {
  const m = ORDER.exec(line);
  if (!m) return null;
  return { quote: m[1] === 'USDC' ? 'USDC' : 'SOL', side: m[2] === 'Yes' ? 'yes' : 'no', amountRaw: Number(m[3]), yesPrice: Number(m[4]) / 1e9, shares: Number(m[6]) / 1e6 };
}

/** Prints inside one confirmed transaction (a transaction can carry more than one order; rare). */
export function tradesFromTx(marketId: string, signature: string, tx: Tx): Trade[] {
  if (!tx.meta || tx.meta.err || !tx.meta.logMessages) return [];
  const k0 = tx.transaction.message.accountKeys[0];
  const wallet = typeof k0 === 'string' ? k0 : k0?.pubkey ?? '';
  const out: Trade[] = [];
  for (const line of tx.meta.logMessages) {
    const o = parseOrderLog(line);
    if (!o) continue;
    const raw = o.amountRaw;
    out.push({
      id: out.length ? `${signature}:${out.length}` : signature, marketId, wallet, isPrimary: true, kind: 'buy', side: o.side,
      shares: o.shares.toFixed(6), yesAmount: o.side === 'yes' ? raw : 0, noAmount: o.side === 'no' ? raw : 0, feePaid: 0,
      amountUsdc: o.quote === 'USDC' ? (raw / 1e6).toFixed(6) : null, blockTime: tx.blockTime, signature, quoteAsset: o.quote,
      price: o.yesPrice, source: 'chain',
    });
  }
  return out;
}

/**
 * Rebuild a market's primary tape from chain. `maxSignatures` bounds the work on a public RPC; a market
 * with more history than that comes back marked incomplete (newest prints first, like the API).
 */
export async function fetchChainTape(marketId: string, opts: { maxSignatures?: number; concurrency?: number; /** Transactions the chain says the market has; a shorter list means the endpoint lacks history. */ expected?: number } = {}): Promise<ChainTapeCache> {
  const max = opts.maxSignatures ?? 300;
  const list = async (at: Endpoint) => {
    const sigs: SigInfo[] = [];
    let before: string | undefined;
    for (;;) {
      const page = await rpc<SigInfo[]>('getSignaturesForAddress', [marketId, { limit: Math.min(1000, max - sigs.length), ...(before ? { before } : {}) }], { at });
      sigs.push(...page);
      if (page.length < 1000 || sigs.length >= max) break;
      before = page[page.length - 1].signature;
    }
    return sigs;
  };
  let at = await historyEndpoint();
  let sigs = await list(at);
  // fewer signatures than the chain counts trades, from a provider: its ledger does not reach back far enough, whatever the probe said
  if (opts.expected && sigs.length < Math.min(opts.expected, max) && isProvider(at.provider) && at.url !== chainEndpoints().history.url) {
    noHistory.set(at.url, Date.now() + HISTORY_PROBE_MS);
    at = await historyEndpoint();
    sigs = await list(at);
  }
  const ok = sigs.filter((s) => !s.err);
  const trades: Trade[] = [];
  let i = 0;
  await Promise.all(Array.from({ length: opts.concurrency ?? 2 }, async () => {
    for (;;) {
      const idx = i++; if (idx >= ok.length) return;
      const s = ok[idx];
      const tx = await rpc<Tx | null>('getTransaction', [s.signature, { encoding: 'json', maxSupportedTransactionVersion: 0 }], { at });
      if (tx) trades.push(...tradesFromTx(marketId, s.signature, tx));
    }
  }));
  trades.sort((a, b) => (b.blockTime ?? 0) - (a.blockTime ?? 0));
  return { ts: Date.now() / 1000, trades, signatures: sigs.length, complete: sigs.length < max };
}

/**
 * Add prints decoded by the live stream to a cached chain tape, once each, newest first. `ts` is the time of the
 * last full rebuild and is left alone, so the radar's staleness rule still rebuilds the tape on schedule; a tape
 * that starts from a streamed print has ts 0 and is rebuilt on the next scan.
 */
export function appendPrints(cache: ChainTapeCache | null, prints: Trade[]): ChainTapeCache {
  const base = cache ?? { ts: 0, trades: [], signatures: 0, complete: false };
  const seen = new Set(base.trades.map((t) => t.id));
  const fresh = prints.filter((t) => !seen.has(t.id));
  if (!fresh.length) return base;
  const trades = [...base.trades, ...fresh].sort((a, b) => (b.blockTime ?? 0) - (a.blockTime ?? 0));
  return { ...base, trades, signatures: base.signatures + new Set(fresh.map((t) => t.signature)).size };
}

/** Union of the API tape and the chain tape by signature, newest first. API rows win on a clash (they carry the API ids). */
export function mergeTapes(api: Trade[], chain: Trade[]): Trade[] {
  const seen = new Set(api.map((t) => t.signature));
  const out = [...api.map((t) => ({ ...t, source: t.source ?? ('api' as const) })), ...chain.filter((t) => !seen.has(t.signature))];
  return out.sort((a, b) => (b.blockTime ?? 0) - (a.blockTime ?? 0));
}

/** True when the API returned fewer prints than the chain says the market has. (`totalTrades` counts the creator's seed too, so this stays true for a complete chain tape as well; the radar's staleness rule decides whether to fetch again.) */
export function tapeIsShort(apiTape: Trade[], totalTrades: unknown): boolean {
  const n = Number(totalTrades ?? 0);
  return Number.isFinite(n) && n > apiTape.filter((t) => (t.kind ?? 'buy') === 'buy').length;
}
