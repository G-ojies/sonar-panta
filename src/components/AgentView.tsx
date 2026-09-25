import Link from 'next/link';
import type { AgentState } from '@/lib/agent';
import type { BacktestSummary } from '@/lib/backtest';
import { ago, cents, usd } from '@/lib/format';
import { explorerTx } from '@/lib/solana';
import { PoweredByPanta } from './PoweredByPanta';
import { Masthead, Strip, cap, plural, words } from './Desk';

type Summary = ReturnType<typeof import('@/lib/agent').summarize>;

export function AgentView({ state, summary, backtest }: { state: AgentState | null; summary: Summary; backtest: BacktestSummary | null }) {
  const now = Date.now() / 1000;
  return (
    <div className="space-y-6">
      <Masthead
        kicker="Agent"
        title={!state
          ? 'The agent has not run yet.'
          : `${cap(state.mode)} mode, ${state.runs} ${plural(state.runs, 'run')} so far: ${words(summary.open)} open ${plural(summary.open, 'position')}, ${summary.closed === 0 ? 'none' : words(summary.closed)} settled.`}
        note="Sonar runs unattended: it rescans the Panta catalog, takes a paper position on every non-flat call (live mode needs medium confidence or better), and settles it when Panta resolves the market. Every call, its reason and its result are on this page, so the record speaks before the slides do."
        aside={<div className="flex items-center gap-3">
          {state && <span className="text-xs text-fog-2"><span className="ping-dot mr-2" aria-hidden />last run {ago(now - state.lastRunAt)} ago</span>}
          <PoweredByPanta />
        </div>}
      />

      <Strip items={[
        { k: 'open', v: summary.open },
        { k: 'settled', v: summary.closed },
        { k: 'hit rate', v: summary.hitRate === null ? 'not yet' : `${Math.round(summary.hitRate * 100)}%`, tone: summary.hitRate === null ? undefined : summary.hitRate >= 0.5 ? 'yes' : 'no' },
        { k: 'P&L', v: usd(summary.pnl), tone: summary.pnl > 0 ? 'yes' : summary.pnl < 0 ? 'no' : undefined },
        { k: 'staked', v: usd(summary.staked) },
      ]} />

      {!state ? (
        <div className="panel p-8 text-center text-sm text-fog">The agent has not run yet. Run <code className="mono text-paper">npm run agent</code> or POST <code className="mono text-paper">/api/agent</code>.</div>
      ) : (
        <section className="panel overflow-x-auto">
          <h2 className="border-b border-line px-4 py-3 font-medium">Positions <span className="text-xs font-normal text-fog-2">{state.positions.length} total</span></h2>
          {state.positions.length === 0 ? <p className="p-6 text-sm text-fog">No calls yet. Every open market is currently flat on Sonar’s read.</p> : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-fog-2"><tr className="border-b border-line"><th className="px-4 py-2 font-medium">Market</th><th className="px-2 py-2 font-medium">Call</th><th className="px-2 py-2 font-medium">Entry</th><th className="px-2 py-2 font-medium">Score</th><th className="px-2 py-2 font-medium">Opened</th><th className="px-2 py-2 font-medium">Result</th></tr></thead>
              <tbody className="mono">
                {state.positions.map((p) => (
                  <tr key={p.id} className="border-t border-line/60 align-top">
                    <td className="max-w-md px-4 py-2 font-sans"><Link href={`/market/${p.marketId}`} className="block truncate text-paper no-underline hover:underline">{p.title}</Link><div className="truncate text-[11px] text-fog-2">{p.reasons.join(' · ')}</div></td>
                    <td className={`px-2 py-2 ${p.side === 'YES' ? 'text-yes' : 'text-no'}`}>{p.side}{p.live && <a className="ml-1 text-[11px]" href={explorerTx(p.live.signature)} target="_blank" rel="noopener noreferrer">live ↗</a>}</td>
                    <td className="px-2 py-2">{cents(p.entryPrice)}</td>
                    <td className="px-2 py-2 text-fog">{p.score} <span className="text-[11px] text-fog-2">{p.confidence}</span></td>
                    <td className="px-2 py-2 text-fog">{ago(now - p.openedAt)} ago</td>
                    <td className={`px-2 py-2 ${p.status === 'won' ? 'text-yes' : p.status === 'lost' ? 'text-no' : 'text-fog'}`}>{p.status}{p.pnl !== undefined && p.status !== 'open' ? ` ${p.pnl >= 0 ? '+' : ''}${p.pnl.toFixed(2)}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {backtest && (
        <section className="panel overflow-x-auto">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-4 py-3">
            <h2 className="font-medium">Backtest on resolved Panta markets</h2>
            <span className="mono text-xs text-fog">{backtest.markets} markets · {backtest.calls} calls · {backtest.hits} hit · {backtest.flat} flat · avg {backtest.pnlPerUsdc === null ? '—' : `${backtest.pnlPerUsdc >= 0 ? '+' : ''}${(backtest.pnlPerUsdc * 100).toFixed(0)}¢`}/USDC</span>
            <span className="ml-auto text-[11px] text-fog-2">signal computed from the first 60% of each tape, then compared with the outcome</span>
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-fog-2"><tr className="border-b border-line"><th className="px-4 py-2 font-medium">Market</th><th className="px-2 py-2 font-medium">Call</th><th className="px-2 py-2 font-medium">Px then</th><th className="px-2 py-2 font-medium">Outcome</th><th className="px-2 py-2 font-medium">Hit</th></tr></thead>
            <tbody className="mono">
              {backtest.rows.map((r) => (
                <tr key={r.marketId} className="border-t border-line/60">
                  <td className="max-w-md px-4 py-1.5 font-sans"><Link href={`/market/${r.marketId}`} className="block truncate text-paper no-underline hover:underline">{r.title}</Link></td>
                  <td className={`px-2 py-1.5 ${r.side === 'YES' ? 'text-yes' : r.side === 'NO' ? 'text-no' : 'text-fog-2'}`}>{r.side} <span className="text-[11px] text-fog-2">{r.score}</span></td>
                  <td className="px-2 py-1.5 text-fog">{cents(r.yesPriceAtCall)}</td>
                  <td className={`px-2 py-1.5 ${r.outcome === 'YES' ? 'text-yes' : 'text-no'}`}>{r.outcome}</td>
                  <td className="px-2 py-1.5">{r.hit === null ? <span className="text-fog-2">flat</span> : r.hit ? <span className="text-yes">✓</span> : <span className="text-no">✗</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {state && state.log.length > 0 && (
        <section className="panel p-4">
          <h2 className="font-medium">Log</h2>
          <ul className="mono mt-2 max-h-64 space-y-1 overflow-auto text-xs text-fog">{state.log.slice(0, 60).map((l, i) => <li key={i}><span className="text-fog-2">{ago(now - l.ts)} ago</span> {l.msg}</li>)}</ul>
        </section>
      )}
    </div>
  );
}
