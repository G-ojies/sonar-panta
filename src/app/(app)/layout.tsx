import Link from 'next/link';
import { WalletButton } from '@/components/WalletButton';
import { PoweredByPanta } from '@/components/PoweredByPanta';
import { SandboxBanner, SandboxToggle } from '@/components/SandboxToggle';
import { Nav } from '@/components/Nav';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="sticky top-0 z-30 border-b border-line bg-ink/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-stretch gap-x-4 px-4 sm:h-14 sm:flex-nowrap sm:gap-x-6 sm:px-6">
          <Link href="/" className="flex h-14 items-center gap-2.5 text-paper no-underline hover:no-underline">
            <span className="ping-dot" aria-hidden />
            <span className="font-semibold tracking-tight">Sonar</span>
            <span className="hidden text-fog-2 sm:inline">for Panta</span>
          </Link>
          <Nav />
          <div className="ml-auto flex h-14 items-center gap-2 sm:gap-3">
            <SandboxToggle />
            <span className="hidden md:inline-flex"><PoweredByPanta compact /></span>
            <WalletButton />
          </div>
        </div>
      </header>
      <SandboxBanner />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">{children}</main>
      <footer className="mx-auto max-w-7xl px-4 pb-10 pt-6 sm:px-6">
        <div className="grid gap-4 border-t border-line pt-6 text-xs text-fog-2 sm:grid-cols-12">
          <p className="max-w-md leading-relaxed sm:col-span-7">
            Built in Benin City by <span className="text-fog">Great Ojietohamen</span>. Sonar is analytics, not advice.
            Trades are non-custodial: nothing moves unless you sign it in your own wallet.
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:col-span-5 sm:justify-end">
            <Link href="/pitch" className="text-fog-2 no-underline hover:text-paper">Pitch</Link>
            <a href="https://github.com/G-ojies/sonar-panta" target="_blank" rel="noopener noreferrer" className="text-fog-2 no-underline hover:text-paper">Source, MIT</a>
            <a href="https://x.com/Great_ojies" target="_blank" rel="noopener noreferrer" className="text-fog-2 no-underline hover:text-paper">@Great_ojies</a>
            <PoweredByPanta />
          </div>
        </div>
      </footer>
    </>
  );
}
