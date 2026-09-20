/**
 * Backtest: replay each resolved market's tape and ask what Sonar would have said
 * before resolution. Gives an honest hit-rate for the signal engine on Panta data.
 */
import { getMarket, getMarketTrades, listMarkets, marketYesPrice } from './panta';
import { computeSignals } from './signals';
import { RESOLVED_IDS_KEY } from './radar';
import { store } from './store';
import type { MarketDetail, Trade } from './types';

export interface BacktestRow {
  marketId: string; title: string; category: string; resolvedAt: number; outcome: 'YES' | 'NO';
  tapeSize: number; asOf: number; yesPriceAtCall: number | null; score: number; side: 'YES' | 'NO' | 'FLAT'; confidence: string; hit: boolean | null;
  /** payoff of 1 USDC placed on Sonar's side at the price then (net of a 2% fee), null when FLAT */
  pnl: number | null;
}
export interface BacktestSummary {
  ranAt: number; markets: number; calls: number; hits: number; hitRate: number | null; flat: number;
  byConfidence: Record<string, { calls: number; hits: number }>; pnlPerUsdc: number | null; rows: BacktestRow[];
  /** API failures hit during the scan (rate limits, 5xx). A scan that is all errors is not a result. */
  errors?: string[];
}

const K = 'sonar:backtest:v1';

/** Replay: use the first `frac` of the tape (by blockTime), price = last trade-implied or detail primary price. */
function callAt(d: MarketDetail, tape: Trade[], frac: number): Omit<BacktestRow, 'marketId' | 'title' | 'category' | 'resolvedAt' | 'outcome' | 'hit' | 'pnl'> {
  const sorted = [...tape].filter((t) => t.blockTime).sort((a, b) => a.blockTime! - b.blockTime!);
  const n = Math.max(1, Math.floor(sorted.length * frac));
  const seen = sorted.slice(0, n);
  const asOf = seen[seen.length - 1]?.blockTime ?? Number(d.endTime);
  // approximate the price at that moment from cumulative YES/NO share flow (parimutuel prior 0.5)
  let y = 0, no = 0;
  for (const t of seen) { const s = Number(t.shares) || 0; if (t.side === 'yes') y += s; else no += s; }
  const prior = Number(d.primaryYesPrice ?? 0.5) > 1 ? 0.5 : Number(d.primaryYesPrice ?? 0.5) || 0.5;
  const yesPriceAtCall = y + no > 0 ? (y + 20 * prior) / (y + no + 20) : prior;
  const s = computeSignals({ ...d, phase: 'primary', onChain: { ...(d.onChain ?? {}), isResolved: false, isActive: true } }, seen.reverse(), [], yesPriceAtCall, null, asOf);
  return { tapeSize: sorted.length, asOf, yesPriceAtCall, score: s.score, side: s.side, confidence: s.confidence };
}

export async function runBacktest(opts: { frac?: number; maxMarkets?: number } = {}): Promise<BacktestSummary> {
  const frac = opts.frac ?? 0.6;
  const seen = new Map<string, MarketDetail>();
  const errors: string[] = [];
  // the catalog's resolved filter returns nothing, so scan the unfiltered + per-category lists
  for (const category of ['', 'sports', 'crypto', 'politics', 'entertainment', 'finance', 'science', 'world', 'other']) {
    const r = await listMarkets({ category: category || undefined, limit: 50 })
      .catch((e) => { errors.push(`list ${category || 'all'}: ${(e as Error).message}`); return { items: [] }; });
    for (const m of r.items) if (m.phase === 'resolved' && !seen.has(m.marketId)) seen.set(m.marketId, m as MarketDetail);
  }
  // plus everything earlier radar scans saw resolve, which the 50-row list pages no longer reach
  const remembered = (await store().get<string[]>(RESOLVED_IDS_KEY)) ?? [];
  const ids = [...new Set([...seen.keys(), ...remembered])].slice(0, opts.maxMarkets ?? 120);
  const rows: BacktestRow[] = [];
  for (const id of ids) {
    try {
      const cached = await store().get<MarketDetail>(`sonar:detail:${id}`);
      const d = cached?.onChain ? cached : await getMarket(id);
      if (!d.onChain?.isResolved) continue;
      const title = d.title || d.question || '';
      if (!title) continue;
      const tape = (await getMarketTrades(id, 200)).items.filter((t) => (t.kind ?? 'buy') === 'buy');
      if (tape.length < 3) continue;
      const outcome: 'YES' | 'NO' = d.onChain.yesWins ? 'YES' : 'NO';
      const c = callAt(d, tape, frac);
      const hit = c.side === 'FLAT' ? null : c.side === outcome;
      let pnl: number | null = null;
      if (c.side !== 'FLAT' && c.yesPriceAtCall !== null) {
        const px = c.side === 'YES' ? c.yesPriceAtCall : 1 - c.yesPriceAtCall;
        pnl = hit ? (1 / Math.max(px, 0.02)) * 0.98 - 1 : -1;
      }
      rows.push({ marketId: id, title, category: d.category, resolvedAt: Number(d.onChain.resolvedAt ?? d.resolutionTime), outcome, ...c, hit, pnl });
    } catch (e) { errors.push(`market ${id}: ${(e as Error).message}`); }
  }
  const calls = rows.filter((r) => r.hit !== null);
  const hits = calls.filter((r) => r.hit).length;
  const byConfidence: BacktestSummary['byConfidence'] = {};
  for (const r of calls) { const b = (byConfidence[r.confidence] ??= { calls: 0, hits: 0 }); b.calls++; if (r.hit) b.hits++; }
  const pnl = calls.length ? calls.reduce((a, r) => a + (r.pnl ?? 0), 0) / calls.length : null;
  const out: BacktestSummary = {
    ranAt: Date.now() / 1000, markets: rows.length, calls: calls.length, hits, hitRate: calls.length ? hits / calls.length : null,
    flat: rows.length - calls.length, byConfidence, pnlPerUsdc: pnl, rows: rows.sort((a, b) => b.resolvedAt - a.resolvedAt), errors,
  };
  // Never replace a good track record with an empty one (rate limit or API outage mid-scan).
  if (rows.length === 0 && errors.length > 0) {
    const prev = await store().get<BacktestSummary>(K);
    return prev?.markets ? { ...prev, errors } : out;
  }
  await store().set(K, out);
  await store().set('sonar:backtest:ranAt', out.ranAt);
  return out;
}

export const readBacktest = () => store().get<BacktestSummary>(K);
/** unrealised-vs-realised marker so pages can show the last price used */
export const lastPrice = marketYesPrice;
