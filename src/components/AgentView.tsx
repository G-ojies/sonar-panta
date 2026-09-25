import Link from 'next/link';
import type { AgentState } from '@/lib/agent';
import type { BacktestSummary } from '@/lib/backtest';
import { ago, cents, usd } from '@/lib/format';
import { explorerTx } from '@/lib/solana';
import { PoweredByPanta } from './PoweredByPanta';
import { ConfidenceDots, ScoreBar } from './SignalBadge';
import { agoWords, cap, plural, words } from './Desk';

type Summary = ReturnType<typeof import('@/lib/agent').summarize>;

const sidePill = (side: string) => (side === 'YES' ? 'pill border-yes/40 bg-yes/15 text-yes' : side === 'NO' ? 'pill border-no/40 bg-no/15 text-no' : 'pill');
const resultPill = (s: string) => (s === 'won' ? 'pill border-yes/40 bg-yes/15 text-yes' : s === 'lost' ? 'pill border-no/40 bg-no/15 text-no' : s === 'open' ? 'pill-ping pill' : 'pill');

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'yes' | 'no' | 'ping' }) {
  const t = tone === 'yes' ? 'text-yes' : tone === 'no' ? 'text-no' : tone === 'ping' ? 'text-ping' : 'text-paper';
  return (
    <div className="card px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-fog-2">{label}</div>
      <div className={`mono mt-1 text-2xl font-semibold ${t}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-fog-2">{hint}</div>}
    </div>
  );
}

export function AgentView({ state, summary, backtest }: { state: AgentState | null; summary: Summary; backtest: BacktestSummary | null }) {
  const now = Date.now() / 1000;
  const title = !state
    ? 'The agent has not run yet.'
    : summary.closed === 0 && summary.open === 0
      ? `${cap(state.mode)} mode, ${state.runs} ${plural(state.runs, 'run')} so far. No position yet: every open market has been flat.`
      : `${cap(state.mode)} mode, ${state.runs} ${plural(state.runs, 'run')}: ${words(summary.open)} open ${plural(summary.open, 'position')}, ${words(summary.closed)} settled${summary.hitRate !== null ? `, ${Math.round(summary.hitRate * 100)}% hit` : ''}.`;

  return (
    <div className="space-y-6">
      <section className="grid gap-4 lg:grid-cols-12 lg:items-end">
        <div className="lg:col-span-8">
          <p className="mb-2 text-xs text-fog-2">Agent</p>
          <h1 className="display">{title}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-fog">
            Every ten minutes the agent rescans Panta, takes a one-dollar paper position on every non-flat Sonar call, and settles it against Panta&apos;s own resolution.
            Each call, its reason and its result are on this page. Judge the engine by this record, not by the slides.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:col-span-4 lg:justify-end">
          {state && (
            <span className="pill">
              <span className="dot-live mr-2" aria-hidden />{state.mode} · run {state.runs}
            </span>
          )}
          <PoweredByPanta />
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Kpi label="Open positions" value={String(summary.open)} hint="paper, $1 each" tone={summary.open ? 'ping' : undefined} />
        <Kpi label="Settled" value={String(summary.closed)} hint={summary.closed ? `${summary.won} won · ${summary.lost} lost` : 'none resolved yet'} />
        <Kpi label="Hit rate" value={summary.hitRate === null ? '–' : `${Math.round(summary.hitRate * 100)}%`} hint={summary.hitRate === null ? 'needs settled calls' : 'won ÷ settled'} tone={summary.hitRate === null ? undefined : summary.hitRate >= 0.5 ? 'yes' : 'no'} />
        <Kpi label="P&L" value={usd(summary.pnl)} hint="on settled positions" tone={summary.pnl > 0 ? 'yes' : summary.pnl < 0 ? 'no' : undefined} />
        <Kpi label="Staked" value={usd(summary.staked)} hint="paper USDC at risk" />
      </section>

      {!state ? (
        <p className="card p-6 text-sm text-fog">The agent has not run yet. It starts with the first scheduled tick.</p>
      ) : (
        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-baseline gap-x-3 border-b border-line px-5 py-4">
            <h2 className="text-base font-semibold">Positions</h2>
            <span className="text-xs text-fog-2">{state.positions.length} {plural(state.positions.length, 'call')} recorded</span>
          </div>
          {state.positions.length === 0 ? (
            <p className="px-5 py-8 text-sm text-fog">No calls yet. Sonar only opens a position when a market&apos;s tape says something, and every open market is flat right now.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-[11px] uppercase tracking-wide text-fog-2">
                  <tr className="border-b border-line">
                    <th className="px-5 py-2.5 font-medium">Market</th>
                    <th className="px-3 py-2.5 font-medium">Call</th>
                    <th className="px-3 py-2.5 font-medium">Entry</th>
                    <th className="px-3 py-2.5 font-medium">Sonar score</th>
                    <th className="px-3 py-2.5 font-medium">Opened</th>
                    <th className="px-3 py-2.5 font-medium">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {state.positions.map((p) => (
                    <tr key={p.id} className="border-t border-line/60 align-top transition-colors hover:bg-ink-3/40">
                      <td className="max-w-md px-5 py-3">
                        <Link href={`/market/${p.marketId}`} className="block truncate font-medium text-paper no-underline hover:underline">{p.title}</Link>
                        <div className="mt-0.5 truncate text-xs text-fog-2">{p.reasons.join(' · ')}</div>
                      </td>
                      <td className="px-3 py-3"><span className={sidePill(p.side)}>{p.side}</span>{p.live && <a className="ml-2 text-[11px]" href={explorerTx(p.live.signature)} target="_blank" rel="noopener noreferrer">live ↗</a>}</td>
                      <td className="mono px-3 py-3">{cents(p.entryPrice)}</td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2"><span className="mono text-fog">{p.score > 0 ? '+' : ''}{p.score}</span><ConfidenceDots level={p.confidence as 'low' | 'medium' | 'high'} /></div>
                        <div className="mt-1"><ScoreBar score={p.score} /></div>
                      </td>
                      <td className="px-3 py-3 text-xs text-fog">{agoWords(now - p.openedAt)} ago</td>
                      <td className="px-3 py-3">
                        <span className={resultPill(p.status)}>{p.status}</span>
                        {p.pnl !== undefined && p.status !== 'open' && <span className={`mono ml-2 text-xs ${p.pnl > 0 ? 'text-yes' : p.pnl < 0 ? 'text-no' : 'text-fog-2'}`}>{p.pnl >= 0 ? '+' : ''}{p.pnl.toFixed(2)}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {backtest && (
        <section className="card overflow-hidden">
          <div className="grid gap-4 border-b border-line px-5 py-4 lg:grid-cols-12 lg:items-center">
            <div className="lg:col-span-6">
              <h2 className="text-base font-semibold">Backtest: what Sonar would have called</h2>
              <p className="mt-1 text-xs leading-relaxed text-fog-2">For each resolved Panta market, the signal is computed from the first 60% of its tape and compared with how the market resolved. Small sample, reported exactly as it comes out.</p>
            </div>
            <dl className="strip lg:col-span-6 lg:justify-end">
              <div><dt>markets</dt><dd className="mono text-paper">{backtest.markets}</dd></div>
              <div><dt>calls</dt><dd className="mono text-paper">{backtest.calls}</dd></div>
              <div><dt>hit</dt><dd className={`mono ${backtest.hitRate !== null && backtest.hitRate >= 0.5 ? 'text-yes' : 'text-paper'}`}>{backtest.hits}{backtest.hitRate !== null ? ` (${Math.round(backtest.hitRate * 100)}%)` : ''}</dd></div>
              <div><dt>flat</dt><dd className="mono text-fog">{backtest.flat}</dd></div>
              <div><dt>per USDC</dt><dd className={`mono ${backtest.pnlPerUsdc === null ? 'text-fog' : backtest.pnlPerUsdc >= 0 ? 'text-yes' : 'text-no'}`}>{backtest.pnlPerUsdc === null ? '–' : `${backtest.pnlPerUsdc >= 0 ? '+' : ''}${(backtest.pnlPerUsdc * 100).toFixed(0)}¢`}</dd></div>
            </dl>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wide text-fog-2">
                <tr className="border-b border-line">
                  <th className="px-5 py-2.5 font-medium">Market</th>
                  <th className="px-3 py-2.5 font-medium">Call</th>
                  <th className="px-3 py-2.5 font-medium">YES then</th>
                  <th className="px-3 py-2.5 font-medium">Resolved</th>
                  <th className="px-3 py-2.5 font-medium">Hit</th>
                </tr>
              </thead>
              <tbody>
                {backtest.rows.map((r) => (
                  <tr key={r.marketId} className="border-t border-line/60 transition-colors hover:bg-ink-3/40">
                    <td className="max-w-md px-5 py-2.5"><Link href={`/market/${r.marketId}`} className="block truncate text-paper no-underline hover:underline">{r.title}</Link></td>
                    <td className="px-3 py-2.5"><span className={sidePill(r.side)}>{r.side}</span>{r.side !== 'FLAT' && <span className="mono ml-2 text-xs text-fog-2">{r.score > 0 ? '+' : ''}{r.score}</span>}</td>
                    <td className="mono px-3 py-2.5 text-fog">{cents(r.yesPriceAtCall)}</td>
                    <td className="px-3 py-2.5"><span className={sidePill(r.outcome)}>{r.outcome}</span></td>
                    <td className="px-3 py-2.5 text-xs">{r.hit === null ? <span className="text-fog-2">no call</span> : r.hit ? <span className="font-semibold text-yes">hit</span> : <span className="font-semibold text-no">miss</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {state && state.log.length > 0 && (
        <details className="card group">
          <summary className="cursor-pointer list-none px-5 py-4 text-sm font-semibold marker:hidden">
            Run log <span className="ml-2 text-xs font-normal text-fog-2">{state.log.length} lines · click to {'expand'}</span>
          </summary>
          <ul className="mono max-h-72 space-y-1 overflow-auto border-t border-line px-5 py-4 text-xs text-fog">
            {state.log.slice(0, 80).map((l, i) => <li key={i}><span className="text-fog-2">{agoWords(now - l.ts)} ago</span> {l.msg}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}
