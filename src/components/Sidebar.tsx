'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

const nav = [
  { href: '/', label: 'Radar', icon: 'M4 12a8 8 0 1 1 16 0 8 8 0 0 1-16 0zm8-4v4l3 2', match: (p: string) => p === '/' || p.startsWith('/market') },
  { href: '/portfolio', label: 'Portfolio', icon: 'M4 7h16v12H4zM4 11h16M9 7V5h6v2', match: (p: string) => p.startsWith('/portfolio') },
  { href: '/create', label: 'Create', icon: 'M12 5v14M5 12h14', match: (p: string) => p.startsWith('/create') },
  { href: '/agent', label: 'Agent', icon: 'M5 19l4-9 3 6 3-12 4 15', match: (p: string) => p.startsWith('/agent') },
];

export interface Topic { key: string; label: string; count: number }

function SidebarInner({ topics }: { topics: Topic[] }) {
  const path = usePathname() ?? '/';
  const sp = useSearchParams();
  const topic = (sp?.get('topic') ?? '').toLowerCase();
  return (
    <aside className="hidden w-56 shrink-0 lg:block">
      <div className="sticky top-20 space-y-6">
        <nav aria-label="Primary" className="space-y-0.5">
          {nav.map((n) => {
            const active = n.match(path);
            return (
              <Link key={n.href} href={n.href} aria-current={active ? 'page' : undefined} className={`side-link ${active ? 'is-active' : ''}`}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={n.icon} /></svg>
                {n.label}
              </Link>
            );
          })}
        </nav>
        {topics.length > 0 && (
          <div>
            <div className="mb-1 flex items-center justify-between px-3 text-[11px] uppercase tracking-wide text-fog-2">
              <span>Topics</span>
              {topic && <Link href="/" className="normal-case tracking-normal text-fog-2 hover:text-paper">clear</Link>}
            </div>
            <div className="space-y-0.5">
              {topics.map((t) => (
                <Link key={t.key} href={`/?topic=${encodeURIComponent(t.key)}`} className={`side-link ${topic === t.key ? 'is-active' : ''}`}>
                  <span className="truncate">{t.label}</span>
                  <span className="mono ml-auto text-[11px] text-fog-2">{t.count}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

export function Sidebar({ topics }: { topics: Topic[] }) {
  return <Suspense fallback={<aside className="hidden w-56 shrink-0 lg:block" />}><SidebarInner topics={topics} /></Suspense>;
}
