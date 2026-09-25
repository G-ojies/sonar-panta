import type { ReactNode } from 'react';
import Link from 'next/link';

/** Small counts read better as words in a sentence: "four markets", not "4 markets". */
const SMALL = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
export const words = (n: number) => SMALL[n] ?? String(n);
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/** "2 minutes", "an hour", "3 days": for prose, where "2m" reads as a unit of length. */
export function agoWords(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return 'never';
  const s = Math.max(0, Math.round(sec));
  if (s < 45) return 'moments';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} ${plural(m, 'minute')}`;
  const h = Math.round(m / 60);
  if (h < 24) return h === 1 ? 'an hour' : `${h} hours`;
  const d = Math.round(h / 24);
  return `${d} ${plural(d, 'day')}`;
}

/**
 * Page opening: a sentence in the left two-thirds, something to look at on the right.
 * The title is written from live data by the page, so it changes as the desk does.
 */
export function Masthead({ kicker, title, note, aside, children }: { kicker?: ReactNode; title: ReactNode; note?: ReactNode; aside?: ReactNode; children?: ReactNode }) {
  return (
    <section className="grid gap-6 border-b border-line pb-6 lg:grid-cols-12 lg:items-end">
      <div className="lg:col-span-8">
        {kicker && <p className="mb-3 text-xs text-fog-2">{kicker}</p>}
        <h1 className="display">{title}</h1>
        {note && <p className="mt-3 max-w-2xl text-sm leading-relaxed text-fog">{note}</p>}
        {children}
      </div>
      {aside && <div className="flex lg:col-span-4 lg:justify-end">{aside}</div>}
    </section>
  );
}

export interface StripItem { k: string; v: ReactNode; tone?: 'yes' | 'no' | 'amber' | 'ping'; href?: string; title?: string }

/** One row of figures with hairlines between them. Replaces the grid of identical tiles. */
export function Strip({ items, className = '' }: { items: StripItem[]; className?: string }) {
  return (
    <dl className={`strip ${className}`}>
      {items.map((i) => {
        const tone = i.tone === 'yes' ? 'text-yes' : i.tone === 'no' ? 'text-no' : i.tone === 'amber' ? 'text-amber' : i.tone === 'ping' ? 'text-ping' : 'text-paper';
        const v = <dd className={`mono ${tone}`}>{i.v}</dd>;
        return (
          <div key={i.k} title={i.title}>
            <dt>{i.k}</dt>
            {i.href ? <Link href={i.href} className="no-underline hover:no-underline">{v}</Link> : v}
          </div>
        );
      })}
    </dl>
  );
}
