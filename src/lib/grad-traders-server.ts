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

async function refresh(prev: State | null): Promise<State> {
  const { markets } = await readAllGradMarkets();
  const newest = { ...(prev?.newest ?? {}) };
  const events = [...(prev?.events ?? [])];
  const known = new Set(events.map((e) => e.sig));
  for (const m of markets) {
    const binding = m.binding.address;
    const fresh = await newSigs(m.binding.pmMarket, newest[binding]);
    if (fresh.length === 0) continue;
    for (let i = 0; i < fresh.length; i += 8) {
      const txs = await Promise.all(fresh.slice(i, i + 8).filter((s) => !known.has(s)).map((s) =>
        marketRpc<ParsedTx | null>('getTransaction', [s, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]).catch(() => null)));
      for (const tx of txs) { const e = tx && tradeFromTx(tx, binding); if (e) { events.push(e); known.add(e.sig); } }
    }
    newest[binding] = fresh[0];
  }
  return { updatedAt: Date.now() / 1000, newest, events };
}

export async function readTraders(fresh = false): Promise<TradersPayload> {
  const now = Date.now() / 1000;
  const s = store();
  let state = memo ?? (await s.get<State>(K));
  if (fresh || !state || now - state.updatedAt >= CACHE_S) {
    state = await refresh(state);
    await s.set(K, state as never);
  }
  memo = state;
  return { ...summarize(state.events), updatedAt: state.updatedAt, markets: Object.keys(state.newest).length };
}
