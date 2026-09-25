/** The Sonar mark: three arcs fanning out from a source dot, on a blue-to-violet tile. */
export function LogoMark({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden focusable="false">
      <defs>
        <linearGradient id="sonar-tile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5b8def" />
          <stop offset="1" stopColor="#a78bfa" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#sonar-tile)" />
      <g fill="none" stroke="#fff" strokeWidth="4.5" strokeLinecap="round">
        <path d="M21 43a13 13 0 0 1 13-13" />
        <path d="M21 43a23 23 0 0 1 23-23" strokeOpacity="0.7" />
        <path d="M21 43a33 33 0 0 1 33-33" strokeOpacity="0.4" />
      </g>
      <circle cx="21" cy="43" r="4.5" fill="#fff" />
    </svg>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark />
      <span className="text-[17px] font-semibold tracking-tight text-paper">Sonar</span>
      {!compact && <span className="hidden text-sm text-fog-2 sm:inline">for Panta</span>}
    </span>
  );
}
