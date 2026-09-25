'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const items = [
  { href: '/', label: 'Radar', match: (p: string) => p === '/' || p.startsWith('/market') },
  { href: '/portfolio', label: 'Portfolio', match: (p: string) => p.startsWith('/portfolio') },
  { href: '/create', label: 'Create', match: (p: string) => p.startsWith('/create') },
  { href: '/agent', label: 'Agent', match: (p: string) => p.startsWith('/agent') },
];

export function Nav() {
  const path = usePathname() ?? '/';
  return (
    <nav aria-label="Primary" className="order-last -mx-4 flex w-[calc(100%+2rem)] items-stretch overflow-x-auto border-t border-line px-2 sm:order-none sm:mx-0 sm:w-auto sm:self-stretch sm:border-0 sm:px-0">
      {items.map((n) => {
        const active = n.match(path);
        return (
          <Link key={n.href} href={n.href} aria-current={active ? 'page' : undefined} className={`tab ${active ? 'is-active' : ''}`}>
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
