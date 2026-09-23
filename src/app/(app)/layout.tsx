import Link from 'next/link';
import { WalletButton } from '@/components/WalletButton';
import { PoweredByPanta } from '@/components/PoweredByPanta';
import { SandboxBanner, SandboxToggle } from '@/components/SandboxToggle';

const nav = [
  { href: '/', label: 'Radar' },
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/create', label: 'Create' },
  { href: '/agent', label: 'Agent' },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="sticky top-0 z-30 border-b border-line bg-ink/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
          <Link href="/" className="flex items-center gap-2 text-paper no-underline hover:no-underline">
            <span className="ping-dot" aria-hidden />
            <span className="font-semibold tracking-tight">Sonar</span>
            <span className="hidden text-fog-2 sm:inline">for Panta</span>
          </Link>
          <nav aria-label="Primary" className="flex items-center gap-1">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className="rounded-md px-3 py-2 text-sm text-fog no-underline hover:bg-ink-3 hover:text-paper hover:no-underline">
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <Link href="/pitch" className="hidden text-xs text-fog-2 no-underline hover:text-paper md:inline">Pitch</Link>
            <SandboxToggle />
            <PoweredByPanta compact />
            <WalletButton />
          </div>
        </div>
      </header>
      <SandboxBanner />
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      <footer className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-6 text-xs text-fog-2">
        <span>Sonar is analytics, not advice. Trades are non-custodial: you sign every transaction in your own wallet.</span>
        <span className="flex items-center gap-3">
          <a href="https://github.com/G-ojies/sonar-panta" target="_blank" rel="noopener noreferrer" className="text-fog-2 hover:text-paper">MIT · source</a>
          <PoweredByPanta />
        </span>
      </footer>
    </>
  );
}
