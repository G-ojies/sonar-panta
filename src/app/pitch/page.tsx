import type { Metadata } from 'next';
import { readAgent, summarize } from '@/lib/agent';
import { readBacktest } from '@/lib/backtest';
import { readRadar } from '@/lib/radar';
import { Deck } from '@/components/Deck';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Sonar for Panta · Pitch', description: 'Pitch deck: the intelligence layer for on-chain prediction markets, built on the Panta API for Colosseum’s Crypto World’s Fair.' };

export default async function PitchPage() {
  const [radar, bt, agent] = await Promise.all([readRadar(), readBacktest(), readAgent()]);
  const ms = radar?.markets ?? [];
  const a = summarize(agent);
  return (
    <Deck live={{
      markets: ms.length,
      open: ms.filter((m) => m.detail.onChain?.isActive).length,
      matched: ms.filter((m) => m.venue).length,
      resolved: ms.filter((m) => m.detail.phase === 'resolved').length,
      btMarkets: bt?.markets ?? 0, btCalls: bt?.calls ?? 0, btHits: bt?.hits ?? 0,
      agentOpen: a.open, agentClosed: a.closed, agentWon: a.won, agentRuns: agent?.runs ?? 0,
      updatedAt: radar?.updatedAt ?? null,
    }} />
  );
}
