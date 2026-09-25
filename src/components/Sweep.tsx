/**
 * The sonar sweep: three rings, a slow rotating wedge, and one blip per open market.
 * Decorative and hidden from assistive tech; the numbers it illustrates sit in the strip beside it.
 */
export function Sweep({ blips = 0, size = 176 }: { blips?: number; size?: number }) {
  const r = size / 2;
  const R = r - 2;
  const dots = Array.from({ length: Math.min(blips, 12) }, (_, i) => {
    const a = ((i * 137.5 - 90) * Math.PI) / 180; // golden-angle spread, so blips never line up
    const d = R * (0.28 + 0.6 * ((i * 0.618) % 1));
    return { x: r + Math.cos(a) * d, y: r + Math.sin(a) * d, delay: (i * 0.37) % 4 };
  });
  const ex = r + R * Math.sin(Math.PI / 3);
  const ey = r - R * Math.cos(Math.PI / 3);
  return (
    <svg className="sweep" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden focusable="false">
      <defs>
        <linearGradient id="sweep-wedge" x1="0" y1="0" x2="1" y2="0.6">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.32" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.34, 0.67, 1].map((k) => (
        <circle key={k} cx={r} cy={r} r={R * k} fill="none" stroke="currentColor" strokeOpacity={k === 1 ? 0.28 : 0.16} strokeWidth="1" />
      ))}
      <line x1={r} y1={2} x2={r} y2={size - 2} stroke="currentColor" strokeOpacity="0.1" />
      <line x1={2} y1={r} x2={size - 2} y2={r} stroke="currentColor" strokeOpacity="0.1" />
      <g className="sweep-arm" style={{ transformOrigin: `${r}px ${r}px` }}>
        <path d={`M${r},${r} L${r},${r - R} A${R},${R} 0 0,1 ${ex.toFixed(2)},${ey.toFixed(2)} Z`} fill="url(#sweep-wedge)" />
        <line x1={r} y1={r} x2={r} y2={r - R} stroke="currentColor" strokeOpacity="0.9" strokeWidth="1.5" strokeLinecap="round" />
      </g>
      {dots.map((d, i) => (
        <circle key={i} cx={d.x.toFixed(2)} cy={d.y.toFixed(2)} r="2.6" fill="currentColor" className="sweep-blip" style={{ animationDelay: `${d.delay}s` }} />
      ))}
      <circle cx={r} cy={r} r="2" fill="currentColor" />
    </svg>
  );
}
