'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { CurveStatus } from '@/lib/dbc-math';

/** Base-58 check, the same rule the API applies. */
const isPubkey = (s: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);

/** Paste any DBC pool address: the pool page reads it live even when the index has never met it. */
export function CurveLookup() {
  const router = useRouter();
  const [v, setV] = useState('');
  const ok = isPubkey(v.trim());
  return (
    <form className="flex w-full gap-2 sm:w-auto" onSubmit={(e) => { e.preventDefault(); if (ok) router.push(`/curve/${v.trim()}`); }}>
      <input className="field min-w-0 flex-1 sm:w-80" placeholder="Pool address" value={v} onChange={(e) => setV(e.target.value)} aria-label="Pool address" spellCheck={false} />
      <button className="btn shrink-0" type="submit" disabled={!ok}>Open</button>
    </form>
  );
}

const TONE: Record<CurveStatus, string> = { trading: 'bg-ping/15 text-ping', complete: 'bg-yes/15 text-yes', migrated: 'bg-ink-3 text-fog' };
const LABEL: Record<CurveStatus, string> = { trading: 'on the curve', complete: 'curve complete', migrated: 'graduated' };

export function StatusChip({ status }: { status: CurveStatus }) {
  return <span className={`chip ${TONE[status]}`}>{LABEL[status]}</span>;
}

/** Progress to graduation: quote held over the migration threshold. Full and green once the curve is complete. */
export function ProgressBar({ pct, status, className = '' }: { pct: number | null; status: CurveStatus; className?: string }) {
  const done = status !== 'trading';
  const width = done ? 100 : Math.max(0, Math.min(100, pct ?? 0));
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-ink-3 ${className}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(width)} aria-label="Progress to graduation">
      <div className={`h-full rounded-full ${done ? 'bg-yes' : 'bg-gradient-to-r from-ping to-violet'}`} style={{ width: `${width}%` }} />
    </div>
  );
}
