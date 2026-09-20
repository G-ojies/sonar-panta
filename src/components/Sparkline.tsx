import type { Snapshot } from '@/lib/types';

export function Sparkline({ snaps, w = 96, h = 24 }: { snaps: Snapshot[]; w?: number; h?: number }) {
  const pts = snaps.filter((s) => s.yesPrice !== null).map((s) => ({ x: s.ts, y: s.yesPrice as number }));
  if (pts.length < 2) return <span className="inline-block text-[11px] text-fog-2" style={{ width: w }}>—</span>;
  const x0 = pts[0].x, x1 = pts[pts.length - 1].x || x0 + 1;
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${(((p.x - x0) / (x1 - x0 || 1)) * (w - 2) + 1).toFixed(1)},${((1 - p.y) * (h - 2) + 1).toFixed(1)}`).join(' ');
  const up = pts[pts.length - 1].y >= pts[0].y;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="inline-block align-middle" role="img" aria-label={`YES price ${pts[0].y.toFixed(2)} to ${pts[pts.length - 1].y.toFixed(2)}`}>
      <path d={d} fill="none" stroke={up ? '#4ade80' : '#f87171'} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
