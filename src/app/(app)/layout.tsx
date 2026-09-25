import Link from 'next/link';
import { WalletButton } from '@/components/WalletButton';
import { PoweredByPanta } from '@/components/PoweredByPanta';
import { SandboxBanner, SandboxToggle } from '@/components/SandboxToggle';
import { Nav } from '@/components/Nav';
import { Logo } from '@/components/Logo';
import { Sidebar, type Topic } from '@/components/Sidebar';
import { Ticker } from '@/components/Ticker';
import { readRadar } from '@/lib/radar';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const radar = await readRadar().catch(() => null);
  const markets = radar?.markets ?? [];
  const counts = new Map<string, number>();
  for (const m of markets) { const k = (m.detail.category || 'other').toLowerCase(); counts.set(k, (counts.get(k) ?? 0) + 1); }
  const topics: Topic[] = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 9).map(([key, count]) => ({ key, count, label: key.charAt(0).toUpperCase() + key.slice(1).replace(/-/g, ' ') }));

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-line/70 bg-ink/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-stretch gap-x-4 px-4 sm:h-16 sm:flex-nowrap sm:gap-x-6 sm:px-6">
          <Link href="/" className="flex h-16 items-center no-underline hover:no-underline"><Logo /></Link>
          <span className="contents lg:hidden"><Nav /></span>
          <div className="ml-auto flex h-16 items-center gap-2 sm:gap-3">
            <SandboxToggle />
            <span className="hidden md:inline-flex"><PoweredByPanta compact /></span>
            <WalletButton />
          </div>
        </div>
      </header>
      <SandboxBanner />
      <div className="mx-auto flex max-w-[1400px] gap-8 px-4 py-6 sm:px-6 lg:py-8">
        <Sidebar topics={topics} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
      <footer className="mx-auto max-w-[1400px] px-4 pb-28 pt-4 sm:px-6">
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
      <Ticker markets={markets} />
    </>
  );
}
