import { readRadar, readRefreshLog } from '@/lib/radar';
import { readBacktest } from '@/lib/backtest';
import { RadarTable } from '@/components/RadarTable';
import { ago } from '@/lib/format';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function RadarPage() {
  const [radar, bt, log] = await Promise.all([readRadar(), readBacktest(), readRefreshLog()]);
  const now = Date.now() / 1000;
  const markets = radar?.markets ?? [];
  const live = markets.filter((m) => m.tradable).length;
  const open = markets.filter((m) => m.detail.onChain?.isActive).length;
  const matched = markets.filter((m) => m.venue).length;
  const calls = markets.filter((m) => m.signals.side !== 'FLAT' && m.detail.phase !== 'resolved').length;

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Radar</h1>
          <p className="mt-1 max-w-2xl text-sm text-fog">
            Every Panta market the API exposes, scored from its own trade tape and priced against Polymarket and Kalshi.
            Positive score leans YES, negative leans NO.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-fog-2">
          <span className="ping-dot" aria-hidden />
          {radar ? <span>scan {ago(now - radar.updatedAt)} ago · {radar.scanned} rows · {radar.durationMs ? `${(radar.durationMs / 1000).toFixed(0)}s` : ''}</span> : <span>radar has not run yet</span>}
          {log[0]?.errors ? <span className="text-amber">· {log[0].errors} API errors</span> : null}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Open on-chain" value={open} hint="isActive from Panta detail" />
        <Stat label="Tradable now" value={live} hint="primary phase, buys accepted" />
        <Stat label="Cross-venue matches" value={matched} hint="same question found elsewhere" />
        <Stat label="Active calls" value={calls} hint="non-flat Sonar signals" />
      </section>

      {bt && bt.calls > 0 && (
        <section className="panel flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-sm">
          <span className="font-medium">Backtest on resolved Panta markets</span>
          <span className="mono text-fog">{bt.markets} markets · {bt.calls} calls · <span className="text-paper">{bt.hits} hit</span> ({bt.hitRate !== null ? Math.round(bt.hitRate * 100) : 0}%) · {bt.flat} flat</span>
          <Link href="/agent" className="ml-auto text-xs">see the agent’s record →</Link>
        </section>
      )}

      {!radar ? (
        <div className="panel p-8 text-center text-sm text-fog">
          Radar is empty. Run <code className="mono text-paper">npm run snapshot</code> or hit <code className="mono text-paper">/api/refresh</code>.
        </div>
      ) : (
        <RadarTable markets={markets} now={now} />
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: number | string; hint: string }) {
  return (
    <div className="panel px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-fog-2">{label}</div>
      <div className="mono mt-1 text-2xl font-semibold">{value}</div>
      <div className="text-xs text-fog-2">{hint}</div>
    </div>
  );
}
