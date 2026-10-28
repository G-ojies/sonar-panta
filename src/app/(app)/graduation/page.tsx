import { GraduationMarkets } from '@/components/GraduationMarkets';
import { readGrad } from '@/lib/grad-market-server';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Graduation markets · Sonar' };

export default async function GraduationPage() {
  const initial = await readGrad().catch(() => null);
  const trading = initial?.markets.filter((m) => m.phase === 'trading').length ?? 0;
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-wide text-fog-2">pm-AMM · devnet</p>
        <h1 className="text-2xl font-semibold text-paper sm:text-3xl">Will this launch graduate?</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-fog">
          Prediction markets on Meteora bonding-curve launches, priced continuously by pm-AMM and resolved by no one&apos;s say-so.
          The market reads the pool account itself, and the moment the pool shows the answer, anyone can pull the liquidity so nobody trades on what is already known.
          {initial ? ` ${trading} ${trading === 1 ? 'market is' : 'markets are'} trading now.` : ''}
        </p>
      </header>
      <GraduationMarkets initial={initial} />
    </div>
  );
}
