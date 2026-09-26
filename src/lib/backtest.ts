/**
 * Replay: run the agent's own rule, print by print, over every resolved Panta market with a tape.
 *
 * For each market the prints are walked in time order. After each one Sonar is asked for its read on
 * the tape so far, exactly as the agent asks it every ten minutes on a live market. The first non-flat
 * read opens a one-USDC paper position at the YES price the chain logged after that print (or, for the
 * few API-only tapes that carry no price, a parimutuel estimate). The position settles against how Panta
 * resolved the market. No look-ahead: nothing after the opening print is used. The result is the record
 * the agent would have built had it been running since the first of these markets opened.
 */
import { getMarket, getMarketTrades, marketYesPrice } from './panta';
import { computeSignals } from './signals';
import { mergeTapes } from './chain-tape';
import { RESOLVED_IDS_KEY, readChainTape, readRadar } from './radar';
import { store } from './store';
import type { MarketDetail, Snapshot, Trade } from './types';

export interface BacktestRow {
  marketId: string; title: string; category: string; resolvedAt: number; outcome: 'YES' | 'NO';
  tapeSize: number; asOf: number; yesPriceAtCall: number | null; score: number; side: 'YES' | 'NO' | 'FLAT'; confidence: string; hit: boolean | null;
  /** payoff of 1 USDC placed on Sonar's side at the price then (net of a 2% fee), null when FLAT */
  pnl: number | null;
  /** which print opened the position (1-based), null when the market stayed flat */
  openedAfterPrint: number | null;
  /** price paid for Sonar's side, null when FLAT */
  entryPrice: number | null;
  /** how many of the prints were decoded from the program log rather than the API */
  chainPrints: number;
}
export interface BacktestSummary {
  ranAt: number; markets: number; calls: number; hits: number; hitRate: number | null; flat: number;
  byConfidence: Record<string, { calls: number; hits: number }>; pnlPerUsdc: number | null; rows: BacktestRow[];
  /** API failures hit during the scan (rate limits, 5xx). A scan that is all errors is not a result. */
  errors?: string[];
  method?: 'walk-forward';
  /** markets whose tape came, in whole or part, from the chain */
  chainTapes?: number;
}

const K = 'sonar:backtest:v1';

/** Parimutuel estimate of the YES price after a prefix of prints, for tapes without a logged price (prior weight 20 shares). */
function estimateYes(prints: Trade[], prior: number): number {
  let y = 0, n = 0;
  for (const t of prints) { const s = Number(t.shares) || 0; if (t.side === 'yes') y += s; else n += s; }
  return y + n > 0 ? (y + 20 * prior) / (y + n + 20) : prior;
}

/** Walk the tape and return the first print at which the agent would have opened, with the read at that moment. */
export function walkForward(d: MarketDetail, tape: Trade[]) {
  const sorted = tape.filter((t) => t.blockTime && (t.kind ?? 'buy') === 'buy').sort((a, b) => a.blockTime! - b.blockTime!);
  const p0 = Number(d.primaryYesPrice ?? 0.5);
  const prior = p0 > 1 || !(p0 > 0) ? 0.5 : p0;
  const asPrimary = { ...d, phase: 'primary' as const, onChain: { ...(d.onChain ?? {}), isResolved: false, isActive: true } };
  const snaps: Snapshot[] = [];
  let last: { score: number; side: 'YES' | 'NO' | 'FLAT'; confidence: string; yes: number; asOf: number } | null = null;
  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i];
    const seen = sorted.slice(0, i + 1);
    const yes = t.price ?? estimateYes(seen, prior);
    snaps.push({ marketId: d.marketId, ts: t.blockTime!, yesPrice: yes, volumeUsdc: 0, trades: i + 1 });
    const now = t.blockTime! + 1;
    const s = computeSignals(asPrimary, [...seen].reverse(), snaps, yes, null, now);
    last = { score: s.score, side: s.side, confidence: s.confidence, yes, asOf: now };
    // the agent's own gate: a side, and at least ten minutes before the market closes
    if (s.side !== 'FLAT' && Number(d.endTime) - now >= 600) return { opened: i + 1, ...last, tapeSize: sorted.length };
  }
  return { opened: null, ...(last ?? { score: 0, side: 'FLAT' as const, confidence: 'low', yes: prior, asOf: Number(d.endTime) }), tapeSize: sorted.length };
}

export async function runBacktest(opts: { maxMarkets?: number } = {}): Promise<BacktestSummary> {
  const errors: string[] = [];
  const s = store();
  // The radar keeps four months of resolved markets with their tapes (API plus chain-decoded); that is the universe.
  const radar = await readRadar();
  const byId = new Map<string, { detail: MarketDetail; tape: Trade[] }>();
  for (const m of radar?.markets ?? []) if (m.detail.phase === 'resolved' || m.detail.onChain?.isResolved) byId.set(m.detail.marketId, { detail: m.detail, tape: m.tape });
  // plus anything earlier scans saw resolve that has since aged out of the radar
  const remembered = (await s.get<string[]>(RESOLVED_IDS_KEY)) ?? [];
  const ids = [...new Set([...byId.keys(), ...remembered])].slice(0, opts.maxMarkets ?? 200);
  const rows: BacktestRow[] = [];
  let chainTapes = 0;
  for (const id of ids) {
    try {
      let entry = byId.get(id);
      if (!entry) {
        const cached = await s.get<MarketDetail>(`sonar:detail:${id}`);
        const d = cached?.onChain ? cached : await getMarket(id);
        if (!d.onChain?.isResolved) continue;
        const tape = (await getMarketTrades(id, 200)).items;
        entry = { detail: d, tape };
      }
      const d = entry.detail;
      if (!d.onChain?.isResolved && d.phase !== 'resolved') continue;
      const title = d.title || d.question || d.onChain?.question || '';
      if (!title) continue;
      const chain = await readChainTape(id);
      const tape = chain ? mergeTapes(entry.tape, chain.trades) : entry.tape;
      const chainPrints = tape.filter((t) => t.source === 'chain').length;
      if (chainPrints) chainTapes++;
      if (!tape.some((t) => t.blockTime)) continue;
      const outcome: 'YES' | 'NO' = d.onChain?.yesWins ? 'YES' : marketYesPrice(d) === 1 ? 'YES' : 'NO';
      const w = walkForward(d, tape);
      const hit = w.opened === null ? null : w.side === outcome;
      const entryPrice = w.opened === null ? null : w.side === 'YES' ? w.yes : 1 - w.yes;
      const pnl = entryPrice === null ? null : hit ? (1 / Math.max(entryPrice, 0.02)) * 0.98 - 1 : -1;
      rows.push({
        marketId: id, title, category: d.category, resolvedAt: Number(d.onChain?.resolvedAt ?? d.resolutionTime ?? d.endTime), outcome,
        tapeSize: w.tapeSize, asOf: w.asOf, yesPriceAtCall: w.yes, score: w.score, side: w.opened === null ? 'FLAT' : w.side, confidence: w.confidence,
        hit, pnl, openedAfterPrint: w.opened, entryPrice, chainPrints,
      });
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
    method: 'walk-forward', chainTapes,
  };
  // Never replace a good track record with an empty one (rate limit or API outage mid-scan).
  if (rows.length === 0) {
    const prev = await s.get<BacktestSummary>(K);
    return prev?.markets ? { ...prev, errors } : out;
  }
  await s.set(K, out);
  await s.set('sonar:backtest:ranAt', out.ranAt);
  return out;
}

export const readBacktest = () => store().get<BacktestSummary>(K);
/** unrealised-vs-realised marker so pages can show the last price used */
export const lastPrice = marketYesPrice;
