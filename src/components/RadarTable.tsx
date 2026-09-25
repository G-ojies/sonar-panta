'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { RadarMarket } from '@/lib/types';
import { cents, untilText, usd } from '@/lib/format';
import { ConfidenceDots, ScoreBar, SideChip } from './SignalBadge';

type Filter = 'all' | 'open' | 'tradable' | 'matched' | 'resolved';

export function RadarTable({ markets, now, topic }: { markets: RadarMarket[]; now: number; topic?: string }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return markets.filter((m) => {
      const d = m.detail;
      if (topic && (d.category || 'other').toLowerCase() !== topic) return false;
      if (filter === 'open' && !d.onChain?.isActive) return false;
      if (filter === 'tradable' && !m.tradable) return false;
      if (filter === 'matched' && !m.venue) return false;
      if (filter === 'resolved' && d.phase !== 'resolved') return false;
      if (t && !`${d.title} ${d.question ?? ''} ${d.category}`.toLowerCase().includes(t)) return false;
      return true;
    });
  }, [markets, filter, q, topic]);

  const counts = useMemo(() => ({
    all: markets.length,
    open: markets.filter((m) => m.detail.onChain?.isActive).length,
    tradable: markets.filter((m) => m.tradable).length,
    matched: markets.filter((m) => m.venue).length,
    resolved: markets.filter((m) => m.detail.phase === 'resolved').length,
  }), [markets]);
  const tabs: { k: Filter; label: string }[] = [
    { k: 'all', label: 'All' }, { k: 'open', label: 'Open' }, { k: 'tradable', label: 'Tradable' }, { k: 'matched', label: 'Cross-venue' }, { k: 'resolved', label: 'Resolved' },
  ];

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-line px-4 py-3">
        {topic && <span className="pill pill-ping capitalize">{topic.replace(/-/g, ' ')}</span>}
        <div role="tablist" aria-label="Filter markets" className="flex gap-1 overflow-x-auto whitespace-nowrap">
          {tabs.map((t) => (
            <button key={t.k} role="tab" aria-selected={filter === t.k} onClick={() => setFilter(t.k)} className="filter">
              {t.label} <span className="mono ml-1 text-[11px] text-fog-2">{counts[t.k]}</span>
            </button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-2 text-xs text-fog">
          <span className="sr-only">Search markets</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a question" className="field h-9 w-56" type="search" />
        </label>
      </div>

      {rows.length === 0 ? (
        <p className="max-w-xl px-4 py-8 text-sm leading-relaxed text-fog">
          {filter === 'tradable' ? 'No market is in its primary buy window right now. Panta opens new breaking markets through the day, and the agent keeps watching.' : filter === 'matched' ? 'None of the open questions trades on Polymarket or Kalshi at the moment. The matcher only pairs questions that share a subject, so it reports nothing rather than a wrong match.' : 'No market matches that. Try another filter, or clear the search.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wide text-fog-2">
              <tr className="border-b border-line">
                <th className="px-3 py-2 font-medium">Market</th>
                <th className="px-3 py-2 font-medium">Panta YES</th>
                <th className="px-3 py-2 font-medium">Elsewhere</th>
                <th className="px-3 py-2 font-medium">Sonar</th>
                <th className="px-3 py-2 font-medium">Tape</th>
                <th className="px-3 py-2 font-medium">Volume</th>
                <th className="px-3 py-2 font-medium">Closes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const d = m.detail; const s = m.signals;
                const title = d.title || d.question || d.onChain?.question || d.marketId;
                return (
                  <tr key={d.marketId} className="border-b border-line/60 transition-colors duration-150 hover:bg-ink-2">
                    <td className="max-w-md px-3 py-2.5">
                      <Link href={`/market/${d.marketId}`} className="block truncate font-medium text-paper no-underline hover:underline" title={title}>{title}</Link>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-fog-2">
                        <span className="uppercase">{d.category}</span>
                        <span>·</span>
                        <span className={m.tradable ? 'text-ping' : d.onChain?.isActive ? 'text-fog' : ''}>{m.tradable ? 'primary · tradable' : d.phase}</span>
                        {d.marketType === 'breaking' && <span className="chip bg-amber/15 text-amber">breaking</span>}
                      </div>
                    </td>
                    <td className="mono px-3 py-2">{cents(m.yesPrice)}</td>
                    <td className="mono px-3 py-2">
                      {m.venue ? (
                        <a href={m.venue.url} target="_blank" rel="noopener noreferrer" className="text-paper" title={`${m.venue.question} (similarity ${m.venue.similarity.toFixed(2)})`}>
                          {cents(m.venue.yesPrice)} <span className="text-[11px] text-fog-2">{m.venue.venue === 'polymarket' ? 'PM' : 'KS'}</span>
                          {s.crossVenueGap !== null && Math.abs(s.crossVenueGap) >= 0.05 && (
                            <span className={`ml-1 text-[11px] ${s.crossVenueGap > 0 ? 'text-yes' : 'text-no'}`}>{s.crossVenueGap > 0 ? '+' : ''}{Math.round(s.crossVenueGap * 100)}</span>
                          )}
                        </a>
                      ) : <span className="text-[11px] text-fog-2">only on Panta</span>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2"><SideChip side={s.side} score={s.score} /><ConfidenceDots level={s.confidence} /></div>
                      <div className="mt-1"><ScoreBar score={s.score} /></div>
                    </td>
                    <td className="mono px-3 py-2 text-fog">{d.onChain?.totalTrades ?? m.tape.length}<span className="text-fog-2"> prints</span></td>
                    <td className="mono px-3 py-2 text-fog">{usd(d.totalVolumeUsdc ?? d.volumeUsdc, 0)}</td>
                    <td className="px-3 py-2 text-xs text-fog">{d.phase === 'resolved' ? <span className={d.onChain?.yesWins ? 'text-yes' : 'text-no'}>{d.onChain?.yesWins ? 'YES' : 'NO'} won</span> : untilText(Number(d.endTime) - now)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
