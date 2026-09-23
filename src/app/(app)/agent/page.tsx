import { readAgent, summarize } from '@/lib/agent';
import { readBacktest } from '@/lib/backtest';
import { AgentView } from '@/components/AgentView';
export const dynamic = 'force-dynamic';
export default async function AgentPage() {
  const [st, bt] = await Promise.all([readAgent(), readBacktest()]);
  return <AgentView state={st} summary={summarize(st)} backtest={bt} />;
}
