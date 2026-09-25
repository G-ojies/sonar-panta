'use client';
import { useEffect, useState, type ReactNode } from 'react';

const KEY = 'sonar:ticker-hidden';

/** Wraps the live strip: desktop only, and a close button that is remembered in this browser. */
export function TickerShell({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(true);
  useEffect(() => { try { setHidden(localStorage.getItem(KEY) === '1'); } catch { setHidden(false); } }, []);
  if (hidden) return null;
  return (
    <div className="ticker hidden sm:flex" role="region" aria-label="Live markets">
      {children}
      <button type="button" aria-label="Hide the live strip" title="Hide" onClick={() => { try { localStorage.setItem(KEY, '1'); } catch {} setHidden(true); }}
        className="flex h-full w-9 shrink-0 items-center justify-center border-l border-line text-fog-2 hover:text-paper">×</button>
    </div>
  );
}
