import type { SignalSet } from '@/lib/types';

export function SideChip({ side, score }: { side: SignalSet['side']; score: number }) {
  const cls = side === 'YES' ? 'bg-yes/15 text-yes' : side === 'NO' ? 'bg-no/15 text-no' : 'bg-ink-3 text-fog';
  return (
    <span className={`chip mono ${cls}`} aria-label={`Sonar leans ${side}, score ${score}`}>
      {side} {side !== 'FLAT' && <span className="ml-1 opacity-80">{Math.abs(score)}</span>}
    </span>
  );
}

export function ConfidenceDots({ level }: { level: SignalSet['confidence'] }) {
  const n = level === 'high' ? 3 : level === 'medium' ? 2 : 1;
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${level} confidence`} title={`${level} confidence`}>
      {[0, 1, 2].map((i) => <span key={i} className={`h-1.5 w-1.5 rounded-full ${i < n ? 'bg-ping' : 'bg-line'}`} />)}
    </span>
  );
}

/** Tiny horizontal meter, -100..100, centre = flat. */
export function ScoreBar({ score }: { score: number }) {
  const w = Math.min(50, Math.abs(score) / 2);
  const left = score < 0 ? 50 - w : 50;
  return (
    <span className="relative inline-block h-1.5 w-24 overflow-hidden rounded bg-ink-3 align-middle" aria-hidden>
      <span className="absolute inset-y-0 w-px bg-line" style={{ left: '50%' }} />
      <span className={`absolute inset-y-0 rounded ${score >= 0 ? 'bg-yes' : 'bg-no'}`} style={{ left: `${left}%`, width: `${w}%` }} />
    </span>
  );
}
