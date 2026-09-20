/* Run the Sonar agent loop locally: `npm run agent` (one tick) or `npm run agent -- --loop 600` */
import { config as dotenv } from 'dotenv';
dotenv({ path: '.env.local' }); dotenv();
import { runAgent, summarize } from '../src/lib/agent';
import { runBacktest } from '../src/lib/backtest';

const loopIdx = process.argv.indexOf('--loop');
const every = loopIdx > -1 ? Number(process.argv[loopIdx + 1] || 600) : 0;
async function tick() {
  const st = await runAgent();
  const s = summarize(st);
  console.log(`[${new Date().toISOString()}] run#${st.runs} mode=${st.mode} open=${s.open} closed=${s.closed} won=${s.won} lost=${s.lost} pnl=${s.pnl.toFixed(2)}`);
  for (const l of st.log.slice(0, 5)) console.log('   ', l.msg);
  if (st.runs % 6 === 1) { const b = await runBacktest(); console.log(`    backtest: ${b.calls} calls, ${b.hits} hits`); }
}
(async () => {
  for (;;) { try { await tick(); } catch (e) { console.error('tick failed', (e as Error).message); } if (!every) break; await new Promise((r) => setTimeout(r, every * 1000)); }
})();
