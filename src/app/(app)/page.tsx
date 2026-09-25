import { readRadar, readRefreshLog } from '@/lib/radar';
import { readBacktest } from '@/lib/backtest';
import { RadarTable } from '@/components/RadarTable';
import { Masthead, Strip, agoWords, cap, plural, words } from '@/components/Desk';
import { Sweep } from '@/components/Sweep';
import type { StripItem } from '@/components/Desk';

export const dynamic = 'force-dynamic';

export default async function RadarPage() {
  const [radar, bt, log] = await Promise.all([readRadar(), readBacktest(), readRefreshLog()]);
  const now = Date.now() / 1000;
  const markets = radar?.markets ?? [];
  const live = markets.filter((m) => m.tradable).length;
  const open = markets.filter((m) => m.detail.onChain?.isActive).length;
  const matched = markets.filter((m) => m.venue).length;
  const calls = markets.filter((m) => m.signals.side !== 'FLAT' && m.detail.phase !== 'resolved').length;
  const resolved = markets.filter((m) => m.detail.phase === 'resolved').length;
  const last = log[0];

  // The opening line is written from the numbers, so it says what the desk actually sees right now.
  const title = !radar
    ? 'The radar has not run yet.'
    : open === 0
      ? 'Nothing is open on Panta right now.'
      : `${cap(words(open))} ${plural(open, 'market is', 'markets are')} open on Panta right now.` +
        (calls > 0
          ? ` ${cap(words(calls))} ${plural(calls, 'carries', 'carry')} a Sonar call.`
          : ' None of them has enough tape for a read yet.') +
        (matched > 0 ? ` ${cap(words(matched))} also ${plural(matched, 'trades', 'trade')} on Polymarket or Kalshi.` : '');

  const note = radar ? (
    <>
      Last scan {agoWords(now - radar.updatedAt)} ago: {radar.scanned} rows in {radar.durationMs ? `${Math.round(radar.durationMs / 1000)} seconds` : 'a moment'}.
      {last?.skipped ? ` ${last.skipped} came back stripped from Panta and were skipped.` : ''}
      {last?.errors ? <span className="text-amber"> {last.errors} {plural(last.errors, 'call', 'calls')} to the Panta API failed.</span> : null}
      {resolved > 0 ? ` Behind the open markets sit ${resolved} resolved ones, four months of history the backtest and the agent settle against.` : ''}
      {' '}Every market is scored from its own trade tape and priced against Polymarket and Kalshi. Positive leans YES, negative leans NO.
    </>
  ) : (
    <>Run <code className="mono text-paper">npm run snapshot</code> or POST <code className="mono text-paper">/api/agent</code> to take the first scan.</>
  );

  const strip: StripItem[] = [
    { k: 'open on-chain', v: open, title: 'isActive on the Panta detail row' },
    { k: 'tradable now', v: live, tone: live ? 'ping' : undefined, title: 'primary phase, buys accepted' },
    { k: 'on other venues', v: matched, title: 'same question found on Polymarket or Kalshi' },
    { k: 'Sonar calls', v: calls, tone: calls ? 'ping' : undefined, title: 'non-flat signals on open markets' },
    { k: 'resolved history', v: resolved },
  ];
  if (bt && bt.calls > 0) strip.push({ k: 'backtest', v: `${bt.hits} of ${bt.calls} hit`, tone: bt.hitRate !== null && bt.hitRate >= 0.5 ? 'yes' : 'no', href: '/agent', title: `${bt.markets} resolved markets replayed from the first 60% of each tape` });

  return (
    <div className="space-y-8">
      <Masthead kicker="Radar" title={title} note={note} aside={<Sweep blips={open} />}>
        <Strip items={strip} className="mt-6" />
      </Masthead>

      {radar ? (
        <RadarTable markets={markets} now={now} />
      ) : (
        <p className="text-sm text-fog">Nothing to show until the first scan lands.</p>
      )}
    </div>
  );
}
