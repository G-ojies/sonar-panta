import Link from 'next/link';
import { readRadar, readRefreshLog, readSnapshots } from '@/lib/radar';
import { readBacktest } from '@/lib/backtest';
import { RadarTable } from '@/components/RadarTable';
import { LiveChart } from '@/components/LiveChart';
import { SideChip, ConfidenceDots } from '@/components/SignalBadge';
import { agoWords, cap, plural, words } from '@/components/Desk';
import { cents, untilText, usd } from '@/lib/format';
import type { RadarMarket } from '@/lib/types';

export const dynamic = 'force-dynamic';

const q = (m: RadarMarket) => m.detail.title || m.detail.question || m.detail.onChain?.question || m.detail.marketId;
const vol = (m: RadarMarket) => Number(m.detail.totalVolumeUsdc ?? m.detail.volumeUsdc ?? 0);

export default async function RadarPage({ searchParams }: { searchParams?: { topic?: string } }) {
  const [radar, bt, log] = await Promise.all([readRadar(), readBacktest(), readRefreshLog()]);
  const now = Date.now() / 1000;
  const topic = (searchParams?.topic ?? '').toLowerCase() || undefined;
  const markets = radar?.markets ?? [];
  const open = markets.filter((m) => m.detail.onChain?.isActive);
  const live = markets.filter((m) => m.tradable).length;
  const matched = markets.filter((m) => m.venue).length;
  const calls = open.filter((m) => m.signals.side !== 'FLAT').length;
  const last = log[0];

  // the market of the moment: the open one with the most money behind it
  const ranked = [...open].sort((a, b) => vol(b) - vol(a));
  const hero = ranked[0] ?? markets[0];
  const snaps = hero ? await readSnapshots(hero.detail.marketId).catch(() => []) : [];
  const trending = ranked.slice(0, 4);
  const byTopic = new Map<string, number>();
  for (const m of open) { const k = (m.detail.category || 'other').toLowerCase(); byTopic.set(k, (byTopic.get(k) ?? 0) + vol(m)); }
  const hot = [...byTopic.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  // anything about Nigeria, open or resolved, by the words a Nigerian would search for
  const NG = /nigeria|naira|\bcbn\b|\bngx\b|super eagles|dangote|lagos|abuja|tinubu|\bnbs\b|\bmpr\b|bbnaija|afrobeats|burna|wizkid|davido|nnpc|\bpms\b/i;
  const naija = markets.filter((m) => NG.test(q(m))).sort((a, b) => Number(a.detail.phase === 'resolved') - Number(b.detail.phase === 'resolved'));

  const line = !radar
    ? 'The radar has not run yet.'
    : open.length === 0
      ? 'Nothing is open on Panta right now.'
      : `${cap(words(open.length))} ${plural(open.length, 'market is', 'markets are')} open on Panta right now.` +
        (calls > 0 ? ` ${cap(words(calls))} ${plural(calls, 'carries', 'carry')} a Sonar call.` : ' None of them has enough tape for a read yet.') +
        (matched > 0 ? ` ${cap(words(matched))} also ${plural(matched, 'trades', 'trade')} on Polymarket or Kalshi.` : '');

  return (
    <div className="space-y-6">
      {/* status line */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fog-2">
        <span className="dot-live" aria-hidden />
        {radar ? <span>Live from Panta · {radar.scanned} markets scanned</span> : <span>Waiting for the first scan</span>}
        {/* one or two failed calls a scan is Panta's normal weather and is retried next tick; only say so when it is material */}
        {last && (last.errors >= 5 || (radar && now - radar.updatedAt > 1800 && last.errors > 0)) ? <span className="text-amber">· {last.errors} API {plural(last.errors, 'call', 'calls')} failed on the last scan</span> : null}
      </div>

      <div className="grid gap-6 xl:grid-cols-3 xl:items-start">
        {/* hero card */}
        <section className="card xl:col-span-2">
          {hero ? (
            <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-5">
              <div className="space-y-5 lg:col-span-2">
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-fog-2">
                  <span className="pill">{hero.detail.category || 'market'}</span>
                  {hero.detail.marketType === 'breaking' && <span className="pill pill-amber">breaking</span>}
                  {hero.tradable && <span className="pill pill-ping">tradable now</span>}
                </div>
                <h1 className="text-xl font-semibold leading-snug tracking-tight sm:text-2xl">
                  <Link href={`/market/${hero.detail.marketId}`} className="text-paper no-underline hover:underline">{q(hero)}</Link>
                </h1>
                <div className="grid grid-cols-2 gap-3">
                  <div className="price-tile price-yes"><span>Yes</span><strong>{cents(hero.yesPrice)}</strong></div>
                  <div className="price-tile price-no"><span>No</span><strong>{cents(hero.yesPrice === null ? null : 1 - hero.yesPrice)}</strong></div>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fog">
                  <span><span className="mono text-paper">{usd(vol(hero), 0)}</span> vol</span>
                  <span><span className="mono text-paper">{hero.detail.onChain?.totalTrades ?? hero.tape.length}</span> prints</span>
                  <span>{hero.detail.phase === 'resolved' ? 'resolved' : untilText(Number(hero.detail.endTime) - now)}</span>
                </div>
                <div className="rounded-xl bg-ink-3/60 p-3 text-sm">
                  <div className="mb-1 flex items-center gap-2 text-[11px] uppercase tracking-wide text-fog-2">Sonar read <SideChip side={hero.signals.side} score={hero.signals.score} /><ConfidenceDots level={hero.signals.confidence} /></div>
                  <p className="text-fog">{hero.signals.side === 'FLAT' ? (hero.signals.reasons[0] ? cap(hero.signals.reasons[0]) : 'No read yet') : `Leans ${hero.signals.side} with ${hero.signals.confidence} confidence.`}</p>
                </div>
                <Link href={`/market/${hero.detail.marketId}`} className="btn btn-primary w-full sm:w-auto">Open market</Link>
              </div>
              <div className="flex flex-col lg:col-span-3">
                <LiveChart marketId={hero.detail.marketId} snaps={snaps} height={330} poll />
              </div>
            </div>
          ) : (
            <div className="p-8 text-sm text-fog">Nothing to show until the first scan lands.</div>
          )}
        </section>

        {/* trending + hot topics */}
        <aside className="space-y-6">
          <section className="card p-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><span aria-hidden>🔥</span> Trending markets</h2>
            {trending.length === 0 ? <p className="text-sm text-fog-2">No open markets.</p> : (
              <ol className="space-y-3">
                {trending.map((m, i) => (
                  <li key={m.detail.marketId} className="flex items-start gap-3">
                    <span className="mono w-4 pt-0.5 text-xs text-fog-2">{i + 1}</span>
                    <Link href={`/market/${m.detail.marketId}`} className="min-w-0 flex-1 text-sm leading-snug text-paper no-underline hover:underline">{q(m)}</Link>
                    <span className="mono shrink-0 text-right text-xs leading-tight">
                      <span className="block text-yes">{Math.round((m.yesPrice ?? 0.5) * 100)}%</span>
                      <span className="block text-no">{Math.round((1 - (m.yesPrice ?? 0.5)) * 100)}%</span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
          <section className="card p-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><span aria-hidden>🔥</span> Hot topics</h2>
            {hot.length === 0 ? <p className="text-sm text-fog-2">Nothing trading.</p> : (
              <ol className="space-y-2.5">
                {hot.map(([k, v], i) => (
                  <li key={k} className="flex items-center gap-3 text-sm">
                    <span className="mono w-4 text-xs text-fog-2">{i + 1}</span>
                    <Link href={`/?topic=${encodeURIComponent(k)}`} className="flex-1 capitalize text-paper no-underline hover:underline">{k.replace(/-/g, ' ')}</Link>
                    <span className="mono text-xs text-fog">{usd(v, 0)} open</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
          <section className="card p-5">
            <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold"><span aria-hidden>🇳🇬</span> Nigeria desk</h2>
            {naija.length > 0 ? (
              <ol className="mt-2 space-y-2.5">
                {naija.slice(0, 4).map((m) => (
                  <li key={m.detail.marketId} className="flex items-start gap-3 text-sm">
                    <Link href={`/market/${m.detail.marketId}`} className="line-clamp-2 min-w-0 flex-1 leading-snug text-paper no-underline hover:underline" title={q(m)}>{q(m)}</Link>
                    {m.detail.phase === 'resolved'
                      ? <span className={`mono shrink-0 text-xs ${m.detail.onChain?.yesWins ? 'text-yes' : 'text-no'}`}>{m.detail.onChain?.yesWins ? 'YES won' : 'NO won'}</span>
                      : <span className="mono shrink-0 text-xs text-yes">{Math.round((m.yesPrice ?? 0.5) * 100)}%</span>}
                  </li>
                ))}
              </ol>
            ) : (
              <>
                <p className="text-sm leading-relaxed text-fog">Panta&apos;s public API lists no market about Nigeria yet: nothing on the CBN, the naira, inflation, the NGX or the Super Eagles. The first creator to list one earns a share of every trade it attracts.</p>
                <Link href="/create" className="btn mt-3 w-full">Create the first Nigerian market</Link>
              </>
            )}
          </section>
          {bt && bt.calls > 0 && (
            <Link href="/agent" className="card block p-5 no-underline hover:border-fog-2 hover:no-underline">
              <div className="text-[11px] uppercase tracking-wide text-fog-2">Backtest on resolved markets</div>
              <div className="mono mt-1 text-lg font-semibold text-paper">{bt.hits} of {bt.calls} calls hit</div>
              <div className="text-xs text-fog">{bt.markets} markets replayed · {bt.flat} flat · see the agent&apos;s record</div>
            </Link>
          )}
        </aside>
      </div>

      <p className="text-sm text-fog">{line}{live ? ` ${cap(words(live))} ${plural(live, 'is', 'are')} in the primary buy window.` : ''}</p>

      {radar && <RadarTable markets={markets} now={now} topic={topic} />}
    </div>
  );
}
