/**
 * Run every board on the Nigeria board through Panta's create flow in the sandbox:
 * quote → build → register against the pk_test_ fixtures. Nothing on chain, no fee paid.
 *   npx tsx scripts/board-sandbox.ts
 */
import { config as dotenv } from 'dotenv';
dotenv({ path: '.env.local' }); dotenv();
import { BOARDS } from '../src/lib/boards';
import { buildCreate, quoteCreate, registerCreate } from '../src/lib/panta';

const WALLET = 'FHj8ZbHfcbYNhsLU7MyeckpR1a4ZQz8c5F1jyaBdr513';
const opts = { mode: 'test' as const };

(async () => {
  const now = Date.now() / 1000;
  const out: Record<string, unknown>[] = [];
  for (const b of BOARDS) {
    const t0 = Date.now();
    try {
      const q = await quoteCreate({
        wallet: WALLET, question: b.question, title: b.title, description: b.description, resolutionRule: b.resolutionRule,
        sourcesOfTruth: b.sourcesOfTruth, category: b.category, startTime: Math.floor(now + 3700), endTime: b.endTime,
        resolutionTime: Math.max(b.resolutionTime, b.endTime), imageUrl: b.imageUrl, marketType: b.marketType, region: 'Global',
      }, opts);
      const built = await buildCreate({ createId: q.createId, wallet: WALLET }, opts);
      const reg = await registerCreate({ createId: q.createId, signature: `sandbox${Date.now()}` }, opts);
      const row = { id: b.id, createId: q.createId, expectedEventPda: q.expectedEventPda, feeUsdc: Number(q.paymentUsdc) / 1e6, liquidityUsdc: Number(q.liquidityInjectionUsdc) / 1e6, platformUsdc: Number(q.platformRevenueUsdc) / 1e6, hasTransaction: !!built.transaction, registered: reg.marketId, status: reg.status, ms: Date.now() - t0 };
      out.push(row);
      console.log(`ok   ${b.id.padEnd(7)} fee ${row.feeUsdc} USDC → ${reg.marketId} (${reg.status}) in ${row.ms} ms`);
    } catch (e) { out.push({ id: b.id, error: (e as Error).message }); console.log(`FAIL ${b.id.padEnd(7)} ${(e as Error).message}`); }
  }
  console.log(JSON.stringify(out, null, 1));
})();
