'use client';
import Link from 'next/link';
import type { CurvePool } from '@/lib/curve';
import type { CurvePrint } from '@/lib/dbc';
import { priceFromSqrt, progressPct } from '@/lib/dbc-math';
import { ago, dateShort, fmtBase, fmtPrice, fmtQuote, short } from '@/lib/format';
import { useApi } from './useApi';
import { ProgressBar, StatusChip } from './CurveBits';
import { CurveMarketPanel } from './CurveMarketPanel';
import type { MarketsPayload } from '@/lib/curve-market-server';

interface PoolPayload { program: string; pool: CurvePool; tape: CurvePrint[]; tapeUpdatedAt: number | null; tapeComplete: boolean; fresh: boolean; markets: MarketsPayload | null }

// Solscan links without @/lib/solana, whose web3.js import would add 90 KB to this page
const CLUSTER = process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? 'mainnet-beta';
const suffix = CLUSTER === 'devnet' ? '?cluster=devnet' : '';
const account = (a: string) => `https://solscan.io/account/${a}${suffix}`;
const explorerTx = (sig: string) => `https://solscan.io/tx/${sig}${suffix}`;

export function CurvePoolView({ address }: { address: string }) {
  const { data, error, loading, reload } = useApi<PoolPayload>(`/api/curve/pool/${address}`, [address], 30_000);
  if (loading && !data) return <PoolSkeleton />;
  if (error && !data) return (
    <div className="panel p-8 text-center text-sm">
      <p className="text-no">{/not a Meteora DBC/.test(error) ? `${short(address, 6)} is not a Meteora DBC pool.` : `Could not load this pool: ${error}`}</p>
      <div className="mt-4 flex justify-center gap-2"><Link href="/curve" className="btn">Back to Curve</Link><button className="btn" onClick={reload}>Retry</button></div>
    </div>
  );
  if (!data) return null;
  const { pool: p, tape } = data;
  const now = Date.now() / 1000;
  const q = (raw: string) => Number(raw) / 10 ** p.quote.decimals;
  const b = (raw: string) => Number(raw) / 10 ** p.baseDecimals;
  const left = Math.max(0, p.threshold - p.quoteRaised);

  return (
    <div className="space-y-6">
      <nav className="text-xs text-fog-2"><Link href="/curve">Curve</Link> / <span className="mono">{short(address, 6)}</span></nav>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <h1 className="mono text-xl font-semibold leading-snug tracking-tight">{short(p.baseMint, 8)} <span className="text-base font-normal text-fog">on a {p.quote.symbol} curve</span></h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fog">
            <StatusChip status={p.status} />
            <span>created {p.createdAt ? `${p.createdFrom === 'slot' ? 'about ' : ''}${ago(now - p.createdAt)} ago` : 'at an unknown time'}</span>
            <span>· creator <a href={account(p.creator)} target="_blank" rel="noopener noreferrer" className="mono">{short(p.creator)}</a></span>
            <span>· mint <a href={account(p.baseMint)} target="_blank" rel="noopener noreferrer" className="mono">{short(p.baseMint)}</a></span>
            <span>· pool <a href={account(p.address)} target="_blank" rel="noopener noreferrer" className="mono">{short(p.address)}</a></span>
          </div>
        </div>
        <span className="text-xs text-fog-2">account read {ago(now - p.updatedAt)} ago{data.fresh ? ' · tape just filled' : data.tapeUpdatedAt ? ` · tape ${ago(now - data.tapeUpdatedAt)} ago` : ''}</span>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="card p-5">
            <div className="grid gap-5 lg:grid-cols-5">
              <div className="space-y-3 lg:col-span-2">
                <div className="price-tile border-ping/30 bg-ping/10 text-ping"><span>Price</span><strong>{fmtPrice(p.price)} {p.quote.symbol}</strong></div>
                <div className="rounded-xl border border-line px-4 py-3">
                  <div className="flex items-baseline justify-between text-sm"><span className="font-medium">Graduation</span><strong className="mono text-xl font-semibold text-paper">{p.status === 'trading' ? `${(p.progressPct ?? 0).toFixed(1)}%` : '100%'}</strong></div>
                  <ProgressBar pct={p.progressPct} status={p.status} className="mt-2" />
                  <p className="mono mt-2 text-xs text-fog">
                    {fmtQuote(p.quoteRaised, p.quote.symbol)} of {fmtQuote(p.threshold, p.quote.symbol)}
                    {p.status === 'trading' ? <> · {fmtQuote(left, p.quote.symbol)} to go</> : p.finishCurveAt ? <> · curve filled {dateShort(p.finishCurveAt)} {new Date(p.finishCurveAt * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</> : null}
                  </p>
                </div>
                <p className="text-sm text-fog"><span className="mono text-paper">{p.prints}</span> prints seen, <span className="mono text-yes">{p.buys}</span> buys and <span className="mono text-no">{p.sells}</span> sells, <span className="mono text-paper">{fmtQuote(p.buyQuote, p.quote.symbol)}</span> bought</p>
              </div>
              <div className="lg:col-span-3">
                <CurveChart tape={tape} baseDecimals={p.baseDecimals} quoteDecimals={p.quote.decimals} symbol={p.quote.symbol} height={210} />
              </div>
            </div>
          </section>

          <section className="card p-5">
            <h2 className="font-medium">How graduation works</h2>
            <p className="mt-2 text-sm leading-relaxed text-fog">
              The pool migrates to a Meteora DAMM v2 pool once the quote it holds reaches the config&apos;s migration threshold, {fmtQuote(p.threshold, p.quote.symbol)} here. Progress is <span className="mono">quote_reserve / migration_quote_threshold</span>, read from the pool account <a href={account(p.address)} target="_blank" rel="noopener noreferrer" className="mono">{short(p.address)}</a>; <span className="mono">finish_curve_timestamp</span> is set by the swap that fills the curve and <span className="mono">is_migrated</span> once the DAMM pool exists. Sells move progress back; a curve can sit under the line for a long time.
            </p>
            <dl className="mono mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-xs text-fog sm:grid-cols-3">
              <Row k="quote reserve" v={`${p.quoteReserveRaw} raw`} />
              <Row k="threshold" v={`${p.thresholdRaw} raw`} />
              <Row k="sqrt price" v={p.sqrtPrice} />
              <Row k="base decimals" v={String(p.baseDecimals)} />
              <Row k="config" v={<a href={account(p.config)} target="_blank" rel="noopener noreferrer">{short(p.config)}</a>} />
              <Row k="found by" v={p.foundBy === 'creation' ? 'its creation' : p.foundBy === 'swap' ? 'a swap in a sample' : 'a request'} />
            </dl>
          </section>

          <section className="card overflow-hidden">
            <div className="border-b border-line px-5 py-4">
              <h2 className="font-medium">Curve tape <span className="text-xs font-normal text-fog-2">{tape.length} prints decoded from the program&apos;s events{data.tapeComplete ? ', the whole history' : ', newest first, bounded'}</span></h2>
            </div>
            {tape.length === 0 ? <p className="p-5 text-sm text-fog">No prints decoded yet. The tape fills when the pool is opened or when a refresh picks it, a few transactions at a time.</p> : (
              <div className="max-h-96 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-ink-2 text-left uppercase tracking-wide text-fog-2"><tr><th className="px-4 py-2 font-medium">Side</th><th className="px-2 py-2 font-medium">{p.quote.symbol}</th><th className="px-2 py-2 font-medium">Tokens</th><th className="px-2 py-2 font-medium">Price after</th><th className="px-2 py-2 font-medium">Progress</th><th className="px-2 py-2 font-medium">Wallet</th><th className="px-2 py-2 font-medium">When</th><th className="px-2 py-2 font-medium">Tx</th></tr></thead>
                  <tbody className="mono">
                    {tape.map((t) => {
                      const pct = progressPct(t.quoteReserveAfter, t.migrationThreshold);
                      return (
                        <tr key={t.id} className="border-t border-line/60">
                          <td className={`px-4 py-1.5 ${t.side === 'buy' ? 'text-yes' : 'text-no'}`}>{t.side.toUpperCase()}</td>
                          <td className="px-2 py-1.5">{fmtQuote(q(t.quoteRaw), '')}</td>
                          <td className="px-2 py-1.5 text-fog">{fmtBase(b(t.baseRaw))}</td>
                          <td className="px-2 py-1.5 text-fog">{fmtPrice(priceFromSqrt(t.sqrtPriceAfter, p.baseDecimals, p.quote.decimals))}</td>
                          <td className="px-2 py-1.5 text-fog">{pct === null ? '--' : `${pct.toFixed(1)}%`}</td>
                          <td className="px-2 py-1.5 text-fog">{short(t.wallet)}</td>
                          <td className="px-2 py-1.5 text-fog">{t.blockTime ? `${ago(now - t.blockTime)} ago` : '--'}</td>
                          <td className="px-2 py-1.5"><a href={explorerTx(t.signature)} target="_blank" rel="noopener noreferrer" aria-label="View transaction">{short(t.signature, 3)}</a></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          {/* CURVE-MARKET: the graduation markets from the curve_market program (open, stake YES or NO, resolve, claim) */}
          <CurveMarketPanel pool={p} initial={data.markets} />
          <section className="card p-5">
            <h2 className="font-medium">Largest prints</h2>
            {p.largest.length === 0 ? <p className="mt-2 text-sm text-fog">None decoded yet.</p> : (
              <ol className="mt-2 space-y-2">
                {p.largest.map((l) => (
                  <li key={l.signature} className="flex items-center gap-3 text-sm">
                    <span className={`mono w-10 ${l.side === 'buy' ? 'text-yes' : 'text-no'}`}>{l.side.toUpperCase()}</span>
                    <span className="mono flex-1 text-paper">{fmtQuote(l.quote, p.quote.symbol)}</span>
                    <a href={explorerTx(l.signature)} target="_blank" rel="noopener noreferrer" className="mono text-xs">{short(l.wallet)}</a>
                  </li>
                ))}
              </ol>
            )}
          </section>
          <section className="card p-5 text-xs leading-relaxed text-fog-2">
            JSON for this pool at <code className="mono">/api/curve/pool/{short(address, 4)}</code>. Amounts are decoded from the program&apos;s own EvtSwap2 events, not from an indexer.
          </section>
        </aside>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) { return <div><dt className="text-fog-2">{k}</dt><dd className="truncate text-paper">{v}</dd></div>; }

/** Price along the curve from the tape: one point per print, oldest left. Draws once; a new print redraws. */
function CurveChart({ tape, baseDecimals, quoteDecimals, symbol, height }: { tape: CurvePrint[]; baseDecimals: number; quoteDecimals: number; symbol: string; height: number }) {
  const pts = [...tape].filter((t) => t.blockTime).reverse().map((t) => ({ x: t.blockTime as number, y: priceFromSqrt(t.sqrtPriceAfter, baseDecimals, quoteDecimals), side: t.side }));
  if (pts.length < 2) return <div className="flex h-full min-h-[160px] items-center justify-center rounded-xl border border-line text-sm text-fog-2">The price path draws once two prints are decoded.</div>;
  const w = 600, h = height, padL = 8, padR = 8, padT = 12, padB = 20;
  const x0 = pts[0].x, x1 = pts[pts.length - 1].x || x0 + 1;
  const ys = pts.map((p) => p.y); const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const X = (x: number) => padL + ((x - x0) / (x1 - x0 || 1)) * (w - padL - padR);
  const Y = (y: number) => padT + (1 - (y - yMin) / (yMax - yMin || 1)) * (h - padT - padB);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  const up = last.y >= pts[0].y;
  return (
    <figure className="h-full">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full" role="img" aria-label={`Price from ${fmtPrice(pts[0].y)} to ${fmtPrice(last.y)} ${symbol} over ${pts.length} prints`}>
        <path d={d} fill="none" stroke={up ? '#34d399' : '#fb7185'} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" className="chart-line" />
        {pts.map((p, i) => <circle key={i} cx={X(p.x)} cy={Y(p.y)} r="2" fill={p.side === 'buy' ? '#34d399' : '#fb7185'} opacity="0.8" />)}
        <circle cx={X(last.x)} cy={Y(last.y)} r="3" fill={up ? '#34d399' : '#fb7185'} className="chart-pulse" />
        <text x={padL} y={h - 6} fill="#6a7288" fontSize="10" fontFamily="var(--font-mono)">{dateShort(x0)} {new Date(x0 * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</text>
        <text x={w - padR} y={h - 6} fill="#6a7288" fontSize="10" textAnchor="end" fontFamily="var(--font-mono)">{ago(Date.now() / 1000 - last.x)} ago</text>
        <text x={w - padR} y={padT + 4} fill="#9aa3b8" fontSize="10" textAnchor="end" fontFamily="var(--font-mono)">{fmtPrice(yMax)}</text>
        <text x={w - padR} y={h - padB - 2} fill="#9aa3b8" fontSize="10" textAnchor="end" fontFamily="var(--font-mono)">{fmtPrice(yMin)}</text>
      </svg>
      <figcaption className="mt-1 text-[11px] text-fog-2">Price after each decoded print, {symbol} per token. Green dots are buys, red are sells.</figcaption>
    </figure>
  );
}

function PoolSkeleton() {
  return (
    <div className="space-y-6">
      <div className="skeleton h-4 w-32" />
      <div className="skeleton h-8 w-80" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2"><div className="skeleton h-64" /><div className="skeleton h-40" /><div className="skeleton h-72" /></div>
        <div className="space-y-4"><div className="skeleton h-48" /><div className="skeleton h-32" /></div>
      </div>
    </div>
  );
}
