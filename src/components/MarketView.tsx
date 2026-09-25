'use client';
import Link from 'next/link';
import type { MarketDetail, SignalSet, Snapshot, Trade, VenueMatch } from '@/lib/types';
import { ago, cents, dateShort, short, untilText, usd } from '@/lib/format';
import { marketUrl } from '@/lib/panta-public';
import { explorerTx } from '@/lib/solana';
import { useApi } from './useApi';
import { ConfidenceDots, ScoreBar, SideChip } from './SignalBadge';
import { Sparkline } from './Sparkline';
import { LiveChart } from './LiveChart';
import { TradePanel } from './TradePanel';
import { PoweredByPanta } from './PoweredByPanta';

interface MarketPayload { detail: MarketDetail; yesPrice: number | null; tape: Trade[]; signals: SignalSet; venue: VenueMatch | null; tradable: boolean; snapshots: Snapshot[]; updatedAt: number }

export function MarketView({ id }: { id: string }) {
  const { data, error, loading, reload } = useApi<MarketPayload>(`/api/market/${id}`, [id], 30_000);
  if (loading && !data) return <MarketSkeleton />;
  if (error && !data) return (
    <div className="panel p-8 text-center text-sm">
      <p className="text-no">Could not load this market: {error}</p>
      <button className="btn mt-4" onClick={reload}>Retry</button>
    </div>
  );
  if (!data) return null;
  const { detail: d, signals: s, tape, venue, yesPrice } = data;
  const now = data.updatedAt;
  const title = d.title || d.question || d.onChain?.question || d.marketId;
  const rule = d.resolutionRule || d.onChain?.resolutionRule;
  const oc = d.onChain;

  return (
    <div className="space-y-6">
      <nav className="text-xs text-fog-2"><Link href="/">Radar</Link> / <span className="uppercase">{d.category}</span></nav>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <h1 className="text-xl font-semibold leading-snug tracking-tight">{title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-fog">
            <span className={`chip ${data.tradable ? 'bg-ping/15 text-ping' : oc?.isActive ? 'bg-ink-3 text-fog' : 'bg-ink-3 text-fog-2'}`}>{data.tradable ? 'tradable · primary' : d.phase}</span>
            {d.marketType === 'breaking' && <span className="chip bg-amber/15 text-amber">breaking</span>}
            <span>{d.phase === 'resolved' ? <>resolved <span className={oc?.yesWins ? 'text-yes' : 'text-no'}>{oc?.yesWins ? 'YES' : 'NO'}</span></> : untilText(Number(d.endTime) - now)}</span>
            <span>· created {oc?.createdAt ? dateShort(Number(oc.createdAt)) : '—'}</span>
            <a href={marketUrl(d.marketId)} target="_blank" rel="noopener noreferrer">open on Panta ↗</a>
          </div>
        </div>
        <PoweredByPanta />
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="card p-5">
            <div className="grid gap-5 lg:grid-cols-5">
              <div className="space-y-3 lg:col-span-2">
                <div className="price-tile price-yes"><span>Yes</span><strong>{cents(yesPrice)}</strong></div>
                <div className="price-tile price-no"><span>No</span><strong>{cents(yesPrice === null ? null : 1 - yesPrice)}</strong></div>
                <p className="text-sm text-fog"><span className="mono text-paper">{usd(d.totalVolumeUsdc ?? d.volumeUsdc, 0)}</span> traded across <span className="mono text-paper">{oc?.totalTrades ?? tape.length}</span> prints</p>
              </div>
              <div className="lg:col-span-3">
                <LiveChart marketId={d.marketId} snaps={data.snapshots} height={210} />
              </div>
            </div>
          </section>

          <section className="card p-5">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-medium">Sonar read</h2>
              <SideChip side={s.side} score={s.score} />
              <ConfidenceDots level={s.confidence} />
              <ScoreBar score={s.score} />
              <span className="ml-auto text-xs text-fog-2">24h <Sparkline snaps={data.snapshots.filter((x) => now - x.ts < 86400)} /></span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-paper">
              {s.side === 'FLAT'
                ? <>Sonar reads this market flat{s.reasons[0] ? <>: {s.reasons[0]}</> : ''}. No call until the tape says something.</>
                : <>Sonar leans <span className={s.side === 'YES' ? 'text-yes' : 'text-no'}>{s.side}</span> with {s.confidence} confidence, score {s.score}.</>}
            </p>
            {s.reasons.length > (s.side === 'FLAT' ? 1 : 0) && (
              <ul className="mt-2 space-y-1 text-sm text-fog">
                {s.reasons.slice(s.side === 'FLAT' ? 1 : 0).map((r) => <li key={r} className="flex gap-2"><span className="text-ping" aria-hidden>›</span>{r}</li>)}
              </ul>
            )}
            <dl className="mono mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-xs text-fog sm:grid-cols-3">
              <Row k="flow imbalance" v={`${s.flowImbalance >= 0 ? '+' : ''}${(s.flowImbalance * 100).toFixed(0)}%`} />
              <Row k="momentum 24h" v={s.momentum === null ? '—' : `${s.momentum >= 0 ? '+' : ''}${(s.momentum * 100).toFixed(1)}pts`} />
              <Row k="largest print" v={`${(s.whaleShare * 100).toFixed(0)}% of tape`} />
              <Row k="wallet concentration" v={s.concentration.toFixed(2)} />
              <Row k="velocity" v={`${s.velocity.toFixed(2)}/h`} />
              <Row k="last print" v={s.staleness === null ? 'never' : `${ago(s.staleness)} ago`} />
            </dl>
          </section>

          <section className="card p-5">
            <h2 className="font-medium">Across venues</h2>
            {venue ? (
              <div className="mt-2 flex flex-wrap items-center gap-4 text-sm">
                <a href={venue.url} target="_blank" rel="noopener noreferrer" className="max-w-lg truncate">{venue.question}</a>
                <span className="mono">{venue.venue} YES <strong className="text-paper">{cents(venue.yesPrice)}</strong></span>
                {s.crossVenueGap !== null && <span className={`mono ${Math.abs(s.crossVenueGap) >= 0.05 ? (s.crossVenueGap > 0 ? 'text-yes' : 'text-no') : 'text-fog'}`}>gap {s.crossVenueGap > 0 ? '+' : ''}{Math.round(s.crossVenueGap * 100)}pts</span>}
                <span className="text-xs text-fog-2">match {venue.similarity.toFixed(2)}{venue.volume24h ? ` · ${usd(venue.volume24h, 0)} 24h` : ''}</span>
              </div>
            ) : <p className="mt-2 text-sm text-fog">Not listed on Polymarket or Kalshi. This question trades only on Panta.</p>}
          </section>

          <section className="card p-5">
            <h2 className="font-medium">How it resolves</h2>
            <p className="mt-2 text-sm text-fog">{rule || 'Panta returned no resolution rule for this market.'}</p>
            {(d.sources?.length || oc?.sources?.length) ? <p className="mono mt-2 text-xs text-fog-2">sources: {(d.sources ?? oc?.sources ?? []).join(', ')}</p> : null}
            {d.oracle && <p className="mono text-xs text-fog-2">oracle: {d.oracle}</p>}
          </section>

          <section className="card overflow-hidden">
            <h2 className="border-b border-line px-5 py-4 font-medium">Trade tape <span className="text-xs font-normal text-fog-2">last {tape.length} prints</span></h2>
            {tape.length === 0 ? <p className="p-5 text-sm text-fog">No trades yet. The first print shows here the moment it lands.</p> : (
              <div className="max-h-96 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-ink-2 text-left uppercase tracking-wide text-fog-2"><tr><th className="px-4 py-2 font-medium">Side</th><th className="px-2 py-2 font-medium">Shares</th><th className="px-2 py-2 font-medium">Wallet</th><th className="px-2 py-2 font-medium">When</th><th className="px-2 py-2 font-medium">Tx</th></tr></thead>
                  <tbody className="mono">
                    {tape.map((t) => (
                      <tr key={t.id} className="border-t border-line/60">
                        <td className={`px-4 py-1.5 ${t.side === 'yes' ? 'text-yes' : 'text-no'}`}>{t.kind === 'claim' ? 'claim' : t.side.toUpperCase()}</td>
                        <td className="px-2 py-1.5">{Number(t.shares).toFixed(2)}</td>
                        <td className="px-2 py-1.5 text-fog">{short(t.wallet)}</td>
                        <td className="px-2 py-1.5 text-fog">{t.blockTime ? `${ago(now - t.blockTime)} ago` : '—'}</td>
                        <td className="px-2 py-1.5"><a href={explorerTx(t.signature)} target="_blank" rel="noopener noreferrer" aria-label="View transaction">{short(t.signature, 3)}</a></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <TradePanel market={d} yesPrice={yesPrice} tradable={data.tradable} lean={s.side} onDone={reload} />
        </aside>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) { return <div><dt className="text-fog-2">{k}</dt><dd className="mt-0.5 text-paper">{v}</dd></div>; }

function MarketSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading market">
      <div className="skeleton h-4 w-32" /><div className="skeleton h-7 w-2/3" />
      <div className="skeleton h-10 w-1/2" />
      <div className="skeleton h-40" /><div className="skeleton h-24" />
    </div>
  );
}
