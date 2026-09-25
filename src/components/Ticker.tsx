import Link from 'next/link';
import type { RadarMarket } from '@/lib/types';
import { usd } from '@/lib/format';

/** The live strip along the bottom: recent resolutions and the busiest open markets, looping. */
export function Ticker({ markets }: { markets: RadarMarket[] }) {
  const now = Date.now() / 1000;
  const resolved = markets
    .filter((m) => m.detail.phase === 'resolved')
    .sort((a, b) => (Number(b.detail.onChain?.resolvedAt ?? b.detail.endTime) - Number(a.detail.onChain?.resolvedAt ?? a.detail.endTime)))
    .slice(0, 6)
    .map((m) => ({ id: m.detail.marketId, q: m.detail.title || m.detail.question || '', tag: m.detail.onChain?.yesWins ? 'YES won' : 'NO won', tone: m.detail.onChain?.yesWins ? 'text-yes' : 'text-no', extra: usd(m.detail.totalVolumeUsdc ?? m.detail.volumeUsdc, 0) }));
  const open = markets
    .filter((m) => m.detail.onChain?.isActive && Number(m.detail.endTime) > now)
    .sort((a, b) => Number(b.detail.totalVolumeUsdc ?? 0) - Number(a.detail.totalVolumeUsdc ?? 0))
    .slice(0, 6)
    .map((m) => ({ id: m.detail.marketId, q: m.detail.title || m.detail.question || '', tag: `YES ${Math.round((m.yesPrice ?? 0.5) * 100)}¢`, tone: 'text-ping', extra: `${usd(m.detail.totalVolumeUsdc ?? m.detail.volumeUsdc, 0)} vol` }));
  const items = [...open, ...resolved];
  if (items.length === 0) return null;
  const row = (k: string) => (
    <div className="ticker-row" aria-hidden={k === 'b'}>
      {items.map((it, i) => (
        <Link key={`${k}${i}`} href={`/market/${it.id}`} className="ticker-item">
          <span className={`mono font-semibold ${it.tone}`}>{it.tag}</span>
          <span className="text-fog">on</span>
          <span className="max-w-[28ch] truncate text-paper">{it.q}</span>
          <span className="mono text-fog-2">{it.extra}</span>
        </Link>
      ))}
    </div>
  );
  return (
    <div className="ticker" role="region" aria-label="Live markets">
      <span className="ticker-live"><span className="ping-dot" aria-hidden /> LIVE</span>
      <div className="ticker-track">{row('a')}{row('b')}</div>
    </div>
  );
}
