/**
 * Server reads for the traders leaderboard (grad-traders.ts). For each graduation market it lists the signatures on
 * its pm-AMM market account, newest first, stopping at the newest one already read, and parses only the new ones.
 * State is kept in the store so each page view costs at most a signature list per market. Cached for two minutes.
 */
import { marketRpc } from './curve-market-server';
import { readAllGradMarkets } from './grad-market-server';
import { summarize, tradeFromTx, type ParsedTx, type TradeEvent, type TradersSummary } from './grad-traders';
import { store } from './store';

const K = 'sonar:grad:traders:devnet';
const CACHE_S = 120;
interface State { updatedAt: number; newest: Record<string, string>; events: TradeEvent[] }
export interface TradersPayload extends TradersSummary { updatedAt: number; markets: number }

let memo: State | null = null;

async function newSigs(account: string, until?: string): Promise<string[]> {
  const out: string[] = [];
  let before: string | undefined;
  for (let page = 0; page < 5; page++) {
    const r = await marketRpc<{ signature: string; err: unknown }[]>('getSignaturesForAddress', [account, { limit: 1000, commitment: 'confirmed', ...(until ? { until } : {}), ...(before ? { before } : {}) }]);
    out.push(...r.filter((s) => !s.err).map((s) => s.signature));
    if (r.length < 1000) break;
    before = r[r.length - 1].signature;
  }
  return out;
}

const BUDGET_MS = 35_000; // leave room inside the 60 s function limit; unfinished markets carry over to the next view
const BATCH = 4; // public devnet RPC answers 429 to bigger bursts

/**
 * Reads new trades market by market. A market whose reads fail (429s from the public RPC) keeps its old cursor and is
 * retried on the next refresh, so a rate limit costs a delay, never a lost trade or a failed page.
 */
async function refresh(prev: State | null): Promise<State> {
  const started = Date.now();
  const { markets } = await readAllGradMarkets();
  const newest = { ...(prev?.newest ?? {}) };
  const events = [...(prev?.events ?? [])];
  const known = new Set(events.map((e) => e.sig));
  for (const m of markets) {
    if (Date.now() - started > BUDGET_MS) break;
    const binding = m.binding.address;
    try {
      const fresh = await newSigs(m.binding.pmMarket, newest[binding]);
      if (fresh.length === 0) { newest[binding] ??= ''; continue; }
      let complete = true;
      const todo = fresh.filter((s) => !known.has(s));
      for (let i = 0; i < todo.length; i += BATCH) {
        if (Date.now() - started > BUDGET_MS) { complete = false; break; }
        const txs = await Promise.all(todo.slice(i, i + BATCH).map((s) =>
          marketRpc<ParsedTx | null>('getTransaction', [s, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]).catch(() => undefined)));
        for (const tx of txs) {
          if (tx === undefined) { complete = false; continue; }
          const e = tx && tradeFromTx(tx, binding);
          if (e) { events.push(e); known.add(e.sig); }
        }
      }
      if (complete) newest[binding] = fresh[0];
    } catch { /* rate limited: keep this market's cursor and try again next refresh */ }
  }
  return { updatedAt: Date.now() / 1000, newest, events };
}

export async function readTraders(fresh = false): Promise<TradersPayload> {
  const now = Date.now() / 1000;
  const s = store();
  let state = memo ?? (await s.get<State>(K));
  if (fresh || !state || now - state.updatedAt >= CACHE_S) {
    try {
      state = await refresh(state);
      await s.set(K, state as never);
    } catch (e) {
      if (!state) throw e; // nothing cached yet: report the error
      // otherwise serve the last good board; it refreshes on a later view
    }
  }
  memo = state;
  return { ...summarize(state.events), updatedAt: state.updatedAt, markets: Object.keys(state.newest).length };
}
