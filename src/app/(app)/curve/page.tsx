import Link from 'next/link';
import { Masthead, Strip, agoWords, cap, plural, words } from '@/components/Desk';
import { CurveLookup, ProgressBar, StatusChip } from '@/components/CurveBits';
import { curveEnabled, rankPools, readCurve, type CurvePool } from '@/lib/curve';
import { DBC_PROGRAM } from '@/lib/dbc';
import { ago, fmtPrice, fmtQuote, short } from '@/lib/format';

export const dynamic = 'force-dynamic';

const CURVE_SCAN_TXS = Number(process.env.CURVE_SCAN_TXS ?? 30);

export default async function CurvePage({ searchParams }: { searchParams?: { status?: string } }) {
  const idx = await readCurve();
  const now = Date.now() / 1000;
  const all = rankPools(Object.values(idx?.pools ?? {}));
  const status = ['trading', 'complete', 'migrated'].includes(searchParams?.status ?? '') ? searchParams!.status : undefined;
  const pools = status ? all.filter((p) => p.status === status) : all;
  const trading = all.filter((p) => p.status === 'trading');
  const near = trading.filter((p) => (p.progressPct ?? 0) >= 75);
  const complete = all.filter((p) => p.status === 'complete').length;
  const migrated = all.filter((p) => p.status === 'migrated').length;
  const created = all.filter((p) => p.foundBy === 'creation').length;

  const title = !idx
    ? (curveEnabled() ? 'The curve index has not run yet.' : 'The curve index is switched off.')
    : all.length === 0
      ? 'No curves followed yet.'
      : `${cap(words(trading.length))} ${plural(trading.length, 'curve is', 'curves are')} trading on Meteora right now` +
        (near.length ? `, ${words(near.length)} within reach of graduation.` : '.') +
        (migrated ? ` ${cap(words(migrated))} ${plural(migrated, 'has', 'have')} graduated since Sonar met ${migrated === 1 ? 'it' : 'them'}.` : '');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fog-2">
        <span className="dot-live" aria-hidden />
        {idx ? <span>Live from the Meteora DBC program · {all.length} {plural(all.length, 'pool')} followed · refreshed {agoWords(now - idx.updatedAt)} ago</span> : <span>Waiting for the first refresh</span>}
        {idx && idx.errors.length >= 3 ? <span className="text-amber">· {idx.errors.length} RPC calls failed on the last refresh</span> : null}
      </div>

      <Masthead
        kicker="Sonar Curve"
        title={title}
        note={<>Sonar samples the DBC program&apos;s tape every scan ({CURVE_SCAN_TXS} transactions of the newest hundred) and follows every pool it meets: price along the curve, quote raised and progress to graduation, read from the pool account itself. Paste any pool address to follow it.</>}
        aside={<CurveLookup />}
      >
        {idx && (
          <Strip className="mt-5" items={[
            { k: 'Trading', v: trading.length, tone: 'ping' },
            { k: 'Near graduation', v: near.length, tone: near.length ? 'yes' : undefined, title: '75 percent or more of the way' },
            { k: 'Complete', v: complete },
            { k: 'Graduated', v: migrated },
            { k: 'Seen created', v: created, title: 'Pools whose creation was in a sample' },
            { k: 'Last sample', v: `${idx.sample.transactions} tx`, title: `${idx.sample.signatures} signatures read, ${idx.sample.prints} prints decoded, ${idx.sample.creations} creations` },
          ]} />
        )}
      </Masthead>

      <section className="card">
        <div className="flex flex-wrap items-center gap-1 border-b border-line px-4 py-3">
          {[['', 'All'], ['trading', 'Trading'], ['complete', 'Complete'], ['migrated', 'Graduated']].map(([k, label]) => (
            <Link key={k} href={k ? `/curve?status=${k}` : '/curve'} className="filter no-underline hover:no-underline" aria-selected={(status ?? '') === k} role="tab">{label}</Link>
          ))}
          <span className="ml-auto text-xs text-fog-2">{pools.length} {plural(pools.length, 'pool')}</span>
        </div>
        {pools.length === 0 ? (
          <p className="p-6 text-sm text-fog">{idx ? 'Nothing in this bucket yet. The next refresh may change that.' : 'The first refresh lands with the next scan, about every twenty minutes.'}</p>
        ) : (
          <>
            {/* wide: a table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="text-left text-[11px] uppercase tracking-wide text-fog-2">
                  <tr className="border-b border-line">
                    <th className="px-4 py-2 font-medium">Pool</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="w-56 px-3 py-2 font-medium">Graduation</th>
                    <th className="px-3 py-2 text-right font-medium">Raised</th>
                    <th className="px-3 py-2 text-right font-medium">Price</th>
                    <th className="px-3 py-2 text-right font-medium" title="Prints Sonar has decoded, bounded, not the pool's lifetime count">Prints seen</th>
                    <th className="px-3 py-2 text-right font-medium">Largest</th>
                    <th className="px-4 py-2 text-right font-medium">Age</th>
                  </tr>
                </thead>
                <tbody>
                  {pools.map((p) => <Row key={p.address} p={p} now={now} />)}
                </tbody>
              </table>
            </div>
            {/* narrow: cards */}
            <ul className="divide-y divide-line md:hidden">
              {pools.map((p) => <Card key={p.address} p={p} now={now} />)}
            </ul>
          </>
        )}
      </section>

      <p className="text-xs leading-relaxed text-fog-2">
        The DBC program sees about eleven transactions a second, and a creation is under one percent of them, so this is the set of curves Sonar has met, not every launch on Meteora. Program <a href={`https://solscan.io/account/${DBC_PROGRAM}`} target="_blank" rel="noopener noreferrer" className="mono">{short(DBC_PROGRAM, 6)}</a>. JSON at <code className="mono">/api/curve/launches</code>; see docs/CURVE.md.
      </p>
    </div>
  );
}

const ageOf = (p: CurvePool, now: number) => (p.createdAt ? `${p.createdFrom === 'slot' ? '~' : ''}${ago(now - p.createdAt)}` : `seen ${ago(now - p.firstSeenAt)}`);

function Row({ p, now }: { p: CurvePool; now: number }) {
  const big = p.largest[0];
  return (
    <tr className="border-b border-line/60 last:border-0 hover:bg-ink-3/40">
      <td className="px-4 py-2.5">
        <Link href={`/curve/${p.address}`} className="mono text-paper no-underline hover:underline">{short(p.baseMint, 5)}</Link>
        <div className="text-[11px] text-fog-2">by <span className="mono">{short(p.creator)}</span> · {p.quote.symbol} curve</div>
      </td>
      <td className="px-3 py-2.5"><StatusChip status={p.status} /></td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <ProgressBar pct={p.progressPct} status={p.status} />
          <span className="mono w-14 shrink-0 text-right text-xs text-paper">{p.status === 'trading' ? `${(p.progressPct ?? 0).toFixed(1)}%` : '100%'}</span>
        </div>
      </td>
      <td className="mono px-3 py-2.5 text-right text-xs"><span className="text-paper">{fmtQuote(p.quoteRaised, '')}</span><span className="text-fog-2">/ {fmtQuote(p.threshold, p.quote.symbol)}</span></td>
      <td className="mono px-3 py-2.5 text-right text-xs text-paper">{fmtPrice(p.price)}</td>
      <td className="mono px-3 py-2.5 text-right text-xs"><span className="text-paper">{p.prints}</span> <span className="text-yes">{p.buys}</span>/<span className="text-no">{p.sells}</span></td>
      <td className="mono px-3 py-2.5 text-right text-xs">{big ? <span className={big.side === 'buy' ? 'text-yes' : 'text-no'}>{fmtQuote(big.quote, p.quote.symbol)}</span> : <span className="text-fog-2">--</span>}</td>
      <td className="mono px-4 py-2.5 text-right text-xs text-fog" title={p.createdFrom === 'slot' ? 'From the activation slot, about right' : p.createdFrom === 'event' ? 'From the creation event' : undefined}>{ageOf(p, now)}</td>
    </tr>
  );
}

function Card({ p, now }: { p: CurvePool; now: number }) {
  return (
    <li className="px-4 py-3">
      <Link href={`/curve/${p.address}`} className="block no-underline hover:no-underline">
        <div className="flex items-center justify-between gap-2">
          <span className="mono text-sm text-paper">{short(p.baseMint, 5)}</span>
          <StatusChip status={p.status} />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <ProgressBar pct={p.progressPct} status={p.status} />
          <span className="mono w-14 shrink-0 text-right text-xs text-paper">{p.status === 'trading' ? `${(p.progressPct ?? 0).toFixed(1)}%` : '100%'}</span>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-fog-2">
          <span className="mono text-fog">{fmtQuote(p.quoteRaised, '')}/ {fmtQuote(p.threshold, p.quote.symbol)}</span>
          <span className="mono">{fmtPrice(p.price)} {p.quote.symbol}</span>
          <span className="mono">{p.prints} prints</span>
          <span className="mono">{ageOf(p, now)}</span>
        </div>
      </Link>
    </li>
  );
}
