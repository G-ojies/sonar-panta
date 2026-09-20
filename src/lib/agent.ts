/**
 * Sonar Agent — autonomous loop over the radar. In `paper` mode it opens virtual
 * 1-USDC positions on medium/high-confidence calls and settles them when the market
 * resolves, building a public track record. In `live` mode it additionally executes
 * real primary buys with a server keypair (SONAR_AGENT_KEYPAIR) when a market is tradable.
 */
import { Connection, Keypair } from '@solana/web3.js';
import { buildBuy, getMarket, quoteBuy, reportTrade, submitBuy } from './panta';
import { readRadar, refreshRadar } from './radar';
import { broadcast, compile } from './solana';
import { store } from './store';
import type { RadarMarket } from './types';

export interface PaperPosition {
  id: string; marketId: string; title: string; side: 'YES' | 'NO'; openedAt: number; entryPrice: number; stake: number; score: number; confidence: string;
  reasons: string[]; status: 'open' | 'won' | 'lost' | 'void'; closedAt?: number; pnl?: number; live?: { signature: string; shares: string } | null;
}
export interface AgentState { startedAt: number; lastRunAt: number; runs: number; mode: 'paper' | 'live'; positions: PaperPosition[]; log: { ts: number; msg: string }[] }

const K = 'sonar:agent:v1';
export async function readAgent(): Promise<AgentState | null> { return store().get<AgentState>(K); }

const RANK = { low: 0, medium: 1, high: 2 } as const;
/** Paper mode records every non-flat call (so the track record accrues on a thin catalog); live mode needs medium+. */
function minConfidence(mode: 'paper' | 'live'): keyof typeof RANK {
  const v = process.env.SONAR_AGENT_MIN_CONFIDENCE as keyof typeof RANK | undefined;
  return v && v in RANK ? v : mode === 'live' ? 'medium' : 'low';
}
function shouldOpen(m: RadarMarket, st: AgentState): boolean {
  if (m.detail.phase === 'resolved' || !m.detail.onChain?.isActive) return false;
  if (m.signals.side === 'FLAT' || RANK[m.signals.confidence] < RANK[minConfidence(st.mode)]) return false;
  if (m.signals.timeToClose < 600) return false;
  return !st.positions.some((p) => p.marketId === m.detail.marketId && p.status === 'open');
}

async function maybeLive(m: RadarMarket, side: 'YES' | 'NO', stake: number, log: (s: string) => void) {
  const kp = process.env.SONAR_AGENT_KEYPAIR;
  if (!kp || !m.tradable) return null;
  try {
    const keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(kp)));
    const wallet = keypair.publicKey.toBase58();
    const q = await quoteBuy({ wallet, marketId: m.detail.marketId, side: side.toLowerCase() as 'yes' | 'no', amountUsdc: stake.toFixed(2), userId: 'sonar-agent' });
    const b = await buildBuy({ quoteId: q.quoteId, wallet, maxSlippageBps: 300, userId: 'sonar-agent' });
    const tx = compile(keypair.publicKey, b.instructions, b.recentBlockhash); tx.sign([keypair]);
    const conn = new Connection(process.env.NEXT_PUBLIC_SOLANA_RPC ?? 'https://api.mainnet-beta.solana.com', 'confirmed');
    const signature = await broadcast(conn, tx, b.lastValidBlockHeight);
    await submitBuy({ orderId: b.orderId, signature });
    await reportTrade({ signature, kind: 'buy', userId: 'sonar-agent' }).catch(() => undefined);
    log(`LIVE buy ${side} ${stake} USDC on ${m.detail.marketId.slice(0, 6)} sig ${signature.slice(0, 8)}`);
    return { signature, shares: q.shares };
  } catch (e) { log(`live buy failed on ${m.detail.marketId.slice(0, 6)}: ${(e as Error).message}`); return null; }
}

export async function runAgent(opts: { refresh?: boolean; stake?: number } = {}): Promise<AgentState> {
  const now = Date.now() / 1000;
  const mode = process.env.SONAR_AGENT_MODE === 'live' ? 'live' : 'paper';
  const st: AgentState = (await readAgent()) ?? { startedAt: now, lastRunAt: now, runs: 0, mode, positions: [], log: [] };
  st.mode = mode;
  const log = (msg: string) => { st.log.unshift({ ts: Date.now() / 1000, msg }); st.log.length = Math.min(st.log.length, 200); };
  const radar = opts.refresh === false ? await readRadar() : await refreshRadar({ venues: true });
  if (!radar) { log('radar empty'); await store().set(K, st); return st; }

  // settle open positions whose markets resolved
  for (const p of st.positions.filter((x) => x.status === 'open')) {
    const m = radar.markets.find((x) => x.detail.marketId === p.marketId);
    let d = m?.detail;
    if (!d || d.phase !== 'resolved') { try { d = await getMarket(p.marketId); } catch { continue; } }
    if (d.onChain?.isCancelled || d.phase === 'cancelled') { p.status = 'void'; p.closedAt = now; p.pnl = 0; log(`void ${p.title.slice(0, 40)}`); continue; }
    if (d.onChain?.isResolved || d.phase === 'resolved') {
      const won = (d.onChain?.yesWins ? 'YES' : 'NO') === p.side;
      p.status = won ? 'won' : 'lost'; p.closedAt = now;
      p.pnl = won ? p.stake * (1 / Math.max(p.entryPrice, 0.02)) * 0.98 - p.stake : -p.stake;
      log(`${won ? 'WON' : 'LOST'} ${p.side} ${p.title.slice(0, 40)} pnl ${p.pnl.toFixed(2)}`);
    }
  }
  // open new ones
  const stake = opts.stake ?? Number(process.env.SONAR_AGENT_STAKE ?? 1);
  for (const m of radar.markets) {
    if (!shouldOpen(m, st)) continue;
    const side = m.signals.side as 'YES' | 'NO';
    const yes = m.yesPrice ?? 0.5;
    const entry = side === 'YES' ? yes : 1 - yes;
    const live = mode === 'live' ? await maybeLive(m, side, stake, log) : null;
    st.positions.unshift({
      id: `${m.detail.marketId}-${Math.floor(now)}`, marketId: m.detail.marketId, title: m.detail.title || m.detail.question || m.detail.marketId,
      side, openedAt: now, entryPrice: entry, stake, score: m.signals.score, confidence: m.signals.confidence, reasons: m.signals.reasons, status: 'open', live,
    });
    log(`open ${side} @${(entry * 100).toFixed(0)}¢ ${m.detail.title?.slice(0, 40)} (score ${m.signals.score}, ${m.signals.confidence})`);
  }
  st.runs++; st.lastRunAt = now;
  await store().set(K, st);
  return st;
}

export function summarize(st: AgentState | null) {
  if (!st) return { open: 0, closed: 0, won: 0, lost: 0, hitRate: null as number | null, pnl: 0, staked: 0 };
  const closed = st.positions.filter((p) => p.status === 'won' || p.status === 'lost');
  const won = closed.filter((p) => p.status === 'won').length;
  return {
    open: st.positions.filter((p) => p.status === 'open').length, closed: closed.length, won, lost: closed.length - won,
    hitRate: closed.length ? won / closed.length : null, pnl: closed.reduce((a, p) => a + (p.pnl ?? 0), 0), staked: closed.reduce((a, p) => a + p.stake, 0),
  };
}
