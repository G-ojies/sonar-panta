import type { Snapshot } from '@/lib/types';

/**
 * YES and NO price over time from Sonar's own snapshots. YES in blue, NO in violet,
 * end labels like a trading terminal. Pure SVG, no client code.
 */
export function PriceChart({ snaps, height = 220, className = '', live = false }: { snaps: Snapshot[]; height?: number; className?: string; live?: boolean }) {
  const pts = snaps.filter((s) => s.yesPrice !== null).map((s) => ({ t: s.ts, y: s.yesPrice as number }));
  // 420 wide: the chart sits in a column about that wide on desktop, so text renders near 1:1
  const W = 420, H = height, padR = 46, padL = 8, padT = 14, padB = 30;
  if (pts.length < 2) {
    return (
      <div className={`flex items-center justify-center rounded-xl border border-dashed border-line text-center text-xs text-fog-2 ${className}`} style={{ height }}>
        Recording price history. Panta has no history endpoint, so Sonar takes a snapshot every ten minutes.
      </div>
    );
  }
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1;
  // y range hugs the data like Panta's chart: both lines, a little air, never past 0 or 100
  const vals = pts.flatMap((p) => [p.y, 1 - p.y]);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const air = Math.max(0.04, (hi - lo) * 0.25);
  lo = Math.max(0, lo - air); hi = Math.min(1, hi + air);
  if (hi - lo < 0.1) { const mid = (hi + lo) / 2; lo = Math.max(0, mid - 0.05); hi = Math.min(1, mid + 0.05); }
  const x = (t: number) => padL + ((t - t0) / (t1 - t0 || 1)) * (W - padL - padR);
  const y = (p: number) => padT + (1 - (p - lo) / (hi - lo)) * (H - padT - padB);
  // a soft curve through the points (Catmull-Rom converted to cubic beziers)
  const curve = (f: (p: number) => number) => {
    const P = pts.map((p) => ({ x: x(p.t), y: y(f(p.y)) }));
    if (P.length === 2) return `M${P[0].x.toFixed(1)},${P[0].y.toFixed(1)} L${P[1].x.toFixed(1)},${P[1].y.toFixed(1)}`;
    let d = `M${P[0].x.toFixed(1)},${P[0].y.toFixed(1)}`;
    for (let i = 0; i < P.length - 1; i++) {
      const p0 = P[i - 1] ?? P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] ?? p2;
      const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
    }
    return d;
  };
  const yes = curve((p) => p), no = curve((p) => 1 - p);
  const last = pts[pts.length - 1];
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((k) => lo + (hi - lo) * k);
  const fmt = (t: number) => { const d = new Date(t * 1000); return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}`; };
  // x labels sit at the chart's ends and its exact middle, so they never crowd each other
  const xs = (t1 - t0) > 2 * 3600 ? [t0, (t0 + t1) / 2, t1] : [t0, t1];
  // a tick label that would sit under an end-point label gets out of its way
  const clear = (g: number) => Math.abs(y(g) - y(last.y)) > 11 && Math.abs(y(g) - y(1 - last.y)) > 11;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={`h-auto w-full ${className}`} role="img" aria-label={`YES ${Math.round(pts[0].y * 100)}% to ${Math.round(last.y * 100)}%`}>
      {ticks.map((g) => (
        <g key={g}>
          <line x1={padL} x2={W - padR} y1={y(g)} y2={y(g)} stroke="#1c1f2b" strokeDasharray="2 6" />
          {clear(g) && <text x={W - padR + 8} y={y(g) + 4} fontSize="12" fill="#6a7288" fontFamily="var(--font-mono)">{Math.round(g * 100)}%</text>}
        </g>
      ))}
      <path d={no} fill="none" stroke="#a78bfa" strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" className={live ? 'chart-line' : ''} />
      <path d={yes} fill="none" stroke="#5b8def" strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" className={live ? 'chart-line' : ''} />
      {live && <circle cx={x(last.t)} cy={y(last.y)} r="4" fill="#5b8def" className="chart-pulse" />}
      <circle cx={x(last.t)} cy={y(last.y)} r="4" fill="#5b8def" />
      <circle cx={x(last.t)} cy={y(1 - last.y)} r="4" fill="#a78bfa" />
      <text x={x(last.t) + 8} y={y(last.y) + 4} fontSize="13" fontWeight="600" fill="#5b8def" fontFamily="var(--font-mono)">{Math.round(last.y * 100)}%</text>
      <text x={x(last.t) + 8} y={y(1 - last.y) + 4} fontSize="13" fontWeight="600" fill="#a78bfa" fontFamily="var(--font-mono)">{Math.round((1 - last.y) * 100)}%</text>
      {xs.map((t, i) => (
        <text key={i} x={x(t)} y={H - 8} fontSize="11" fill="#6a7288" textAnchor={i === 0 ? 'start' : i === xs.length - 1 ? 'end' : 'middle'} fontFamily="var(--font-mono)">{fmt(t)}</text>
      ))}
    </svg>
  );
}
