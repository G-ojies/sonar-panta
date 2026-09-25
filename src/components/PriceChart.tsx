import type { Snapshot } from '@/lib/types';

/**
 * YES and NO price over time from Sonar's own snapshots. YES in blue, NO in violet,
 * end labels like a trading terminal. Pure SVG, no client code.
 */
export function PriceChart({ snaps, height = 220, className = '', live = false }: { snaps: Snapshot[]; height?: number; className?: string; live?: boolean }) {
  const pts = snaps.filter((s) => s.yesPrice !== null).map((s) => ({ t: s.ts, y: s.yesPrice as number }));
  // 420 wide: the chart sits in a column about that wide on desktop, so text renders near 1:1
  const W = 420, H = height, padR = 48, padL = 8, padT = 16, padB = 28;
  if (pts.length < 2) {
    return (
      <div className={`flex items-center justify-center rounded-xl border border-dashed border-line text-center text-xs text-fog-2 ${className}`} style={{ height }}>
        Recording price history. Panta has no history endpoint, so Sonar takes a snapshot every ten minutes.
      </div>
    );
  }
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1;
  const x = (t: number) => padL + ((t - t0) / (t1 - t0 || 1)) * (W - padL - padR);
  const y = (p: number) => padT + (1 - p) * (H - padT - padB);
  const path = (f: (p: number) => number) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(f(p.y)).toFixed(1)}`).join(' ');
  const yes = path((p) => p), no = path((p) => 1 - p);
  const last = pts[pts.length - 1];
  const fmt = (t: number) => new Date(t * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const tm = (t0 + t1) / 2;
  const mid = pts.reduce((best, p) => (Math.abs(p.t - tm) < Math.abs(best.t - tm) ? p : best), pts[0]);
  const xs = (t1 - t0) > 3 * 86400 ? [pts[0], mid, last] : [pts[0], last];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={`h-auto w-full ${className}`} role="img" aria-label={`YES ${Math.round(pts[0].y * 100)}% to ${Math.round(last.y * 100)}%`}>
      <defs>
        <linearGradient id="yes-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5b8def" stopOpacity="0.22" />
          <stop offset="1" stopColor="#5b8def" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((g) => <line key={g} x1={padL} x2={W - padR} y1={y(g)} y2={y(g)} stroke="#262a3a" strokeDasharray="3 5" />)}
      <path d={`${yes} L${x(last.t).toFixed(1)},${y(0)} L${x(pts[0].t).toFixed(1)},${y(0)} Z`} fill="url(#yes-fill)" />
      <path d={no} fill="none" stroke="#a78bfa" strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" className={live ? 'chart-line' : ''} />
      <path d={yes} fill="none" stroke="#5b8def" strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" className={live ? 'chart-line' : ''} />
      {live && <circle cx={x(last.t)} cy={y(last.y)} r="4" fill="#5b8def" className="chart-pulse" />}
      <circle cx={x(last.t)} cy={y(last.y)} r="4" fill="#5b8def" />
      <circle cx={x(last.t)} cy={y(1 - last.y)} r="4" fill="#a78bfa" />
      <text x={x(last.t) + 8} y={y(last.y) + 4} fontSize="14" fontWeight="600" fill="#5b8def" fontFamily="var(--font-mono)">{Math.round(last.y * 100)}%</text>
      <text x={x(last.t) + 8} y={y(1 - last.y) + 4} fontSize="14" fontWeight="600" fill="#a78bfa" fontFamily="var(--font-mono)">{Math.round((1 - last.y) * 100)}%</text>
      {xs.map((p, i) => (
        <text key={i} x={x(p.t)} y={H - 6} fontSize="13" fill="#6a7288" textAnchor={i === 0 ? 'start' : i === xs.length - 1 ? 'end' : 'middle'} fontFamily="var(--font-mono)">{fmt(p.t)}</text>
      ))}
    </svg>
  );
}
