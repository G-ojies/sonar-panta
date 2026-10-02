/**
 * Server reads for the graduation markets: the curve_market program's accounts on the cluster it is deployed on,
 * cached briefly in the store so a page poll does not turn into a getProgramAccounts per visitor.
 *
 * The program lives on devnet only (CURVE_MARKET_PROGRAMS in curve-market.ts), so these reads go to a devnet
 * endpoint whatever cluster the rest of the app runs on: CURVE_MARKET_RPC when set, else the app's RPC when the app
 * itself is on devnet, else the public devnet endpoint. The DBC index keeps its own path (chain-tape.ts).
 */
import {
  CURVE_MARKET_PROGRAMS, DEVNET_RPC, fetchMarkets, fetchPositions, rankMarkets, type Cluster, type MarketAccount, type PositionAccount, type RpcCall,
} from './curve-market';
import { K as CURVE_KEYS } from './curve';
import { store } from './store';

export const APP_CLUSTER: Cluster = process.env.NEXT_PUBLIC_SOLANA_CLUSTER === 'devnet' ? 'devnet' : 'mainnet-beta';
/** The cluster the markets are read from: the app's own when the program is deployed there, devnet otherwise. */
export const MARKET_CLUSTER: Cluster = CURVE_MARKET_PROGRAMS[APP_CLUSTER] ? APP_CLUSTER : 'devnet';
export const MARKET_PROGRAM = CURVE_MARKET_PROGRAMS[MARKET_CLUSTER]!;

export function marketRpcUrl(env: Record<string, string | undefined> = process.env): string {
  const custom = env.CURVE_MARKET_RPC?.trim();
  if (custom) return custom;
  if (MARKET_CLUSTER === APP_CLUSTER && env.NEXT_PUBLIC_SOLANA_RPC?.trim()) return env.NEXT_PUBLIC_SOLANA_RPC.trim();
  return DEVNET_RPC;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One JSON-RPC call on the market endpoint, with a short backoff for the public endpoint's 429s. */
export const marketRpc: RpcCall = async <T,>(method: string, params: unknown[]): Promise<T> => {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(marketRpcUrl(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), cache: 'no-store' });
      if (res.status === 429 || res.status >= 500) throw new Error(`rpc ${res.status}`);
      const j = (await res.json()) as { result?: T; error?: { message: string } };
      if (j.error) throw new Error(j.error.message);
      return j.result as T;
    } catch (e) {
      if (i >= 3) throw e;
      await sleep(1000 * 2 ** i);
    }
  }
};

const K = { markets: `sonar:curve:markets:${MARKET_CLUSTER}` };
const CACHE_S = 20;
interface MarketsCache { updatedAt: number; markets: MarketAccount[] }
let memo: { at: number; value: MarketsCache } | null = null;

/** Every market on the program, from the store when it is younger than CACHE_S seconds, else from the chain. */
export async function readAllMarkets(fresh = false): Promise<MarketsCache> {
  const now = Date.now() / 1000;
  if (!fresh && memo && now - memo.at < CACHE_S) return memo.value;
  const s = store();
  if (!fresh) {
    const cached = await s.get<MarketsCache>(K.markets);
    if (cached && now - cached.updatedAt < CACHE_S) { memo = { at: now, value: cached }; return cached; }
  }
  const markets = rankMarkets(await fetchMarkets(marketRpc, undefined, MARKET_PROGRAM));
  const value: MarketsCache = { updatedAt: now, markets };
  await s.set(K.markets, value, 300);
  memo = { at: now, value };
  // the pools with markets are pinned so the index always follows them (only useful when the index is on the same cluster)
  if (MARKET_CLUSTER === APP_CLUSTER && markets.length) {
    const pinned = new Set((await s.get<string[]>(CURVE_KEYS.pinned)) ?? []);
    const before = pinned.size;
    for (const m of markets) if (m.state === 'open') pinned.add(m.pool);
    if (pinned.size !== before) await s.set(CURVE_KEYS.pinned, [...pinned]);
  }
  return value;
}

export interface MarketsPayload {
  cluster: Cluster;
  program: string;
  /** Whether the app's own cluster is the one the markets run on: when false the page shows them read-only. */
  live: boolean;
  updatedAt: number;
  markets: MarketAccount[];
  /** The caller's positions on these markets, when `user` was given. */
  positions: PositionAccount[];
}

/** Markets, optionally on one pool, with the user's positions when a user is named. */
export async function readMarkets(opts: { pool?: string; user?: string; fresh?: boolean } = {}): Promise<MarketsPayload> {
  const all = await readAllMarkets(opts.fresh);
  const markets = opts.pool ? all.markets.filter((m) => m.pool === opts.pool) : all.markets;
  let positions: PositionAccount[] = [];
  if (opts.user && markets.length) {
    const mine = await fetchPositions(marketRpc, opts.user, markets.length === 1 ? markets[0].address : undefined, MARKET_PROGRAM);
    const wanted = new Set(markets.map((m) => m.address));
    positions = mine.filter((p) => wanted.has(p.market));
  }
  return { cluster: MARKET_CLUSTER, program: MARKET_PROGRAM, live: MARKET_CLUSTER === APP_CLUSTER, updatedAt: all.updatedAt, markets, positions };
}

/** Open and resolved market counts per pool, for the list page's chip. */
export async function marketCountsByPool(): Promise<Record<string, { open: number; total: number }>> {
  const { markets } = await readAllMarkets();
  const out: Record<string, { open: number; total: number }> = {};
  for (const m of markets) { const row = (out[m.pool] ??= { open: 0, total: 0 }); row.total++; if (m.state === 'open') row.open++; }
  return out;
}
