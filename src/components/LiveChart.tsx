'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Snapshot } from '@/lib/types';
import { PriceChart } from './PriceChart';
import { useApi } from './useApi';

type Range = '1d' | '7d' | 'all';
const RANGES: { k: Range; label: string; sec: number }[] = [
  { k: '1d', label: '1D', sec: 86400 },
  { k: '7d', label: '7D', sec: 7 * 86400 },
  { k: 'all', label: 'All', sec: Infinity },
];

/**
 * The price chart, alive: a range picker, the line draws in, the last point pulses, and when
 * `poll` is set the snapshots refresh every minute without a page reload. With `fill` the chart
 * measures its box and draws at exactly that size, so it grows to whatever the card gives it.
 */
export function LiveChart({ marketId, snaps, height = 240, poll = false, fill = false }: { marketId: string; snaps: Snapshot[]; height?: number; poll?: boolean; fill?: boolean }) {
  const [range, setRange] = useState<Range>('7d');
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    if (!fill || !box.current) return;
    const el = box.current;
    const ro = new ResizeObserver(([e]) => { const r = e.contentRect; if (r.width > 40 && r.height > 40) setSize({ w: Math.round(r.width), h: Math.round(r.height) }); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fill]);
  const { data } = useApi<{ snapshots: Snapshot[] }>(poll ? `/api/market/${marketId}` : null, [marketId, poll], 60_000);
  const all = data?.snapshots?.length ? data.snapshots : snaps;
  const shown = useMemo(() => {
    const sec = RANGES.find((r) => r.k === range)!.sec;
    if (sec === Infinity) return all;
    const cut = Date.now() / 1000 - sec;
    const inRange = all.filter((s) => s.ts >= cut);
    return inRange.length >= 2 ? inRange : all; // a range with nothing in it falls back to the whole record
  }, [all, range]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex items-center justify-between text-xs text-fog-2">
        <span className="flex items-center gap-4">
          <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-ping" /> YES</span>
          <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-violet" /> NO</span>
        </span>
        <div role="tablist" aria-label="Chart range" className="flex gap-0.5">
          {RANGES.map((r) => (
            <button key={r.k} role="tab" aria-selected={range === r.k} onClick={() => setRange(r.k)} className="filter px-2.5 py-1 text-[11px]">{r.label}</button>
          ))}
        </div>
      </div>
      <div ref={box} className={fill ? 'min-h-[260px] flex-1' : ''}>
        <PriceChart snaps={shown} height={fill && size ? size.h : height} width={fill && size ? size.w : 420} live />
      </div>
    </div>
  );
}
