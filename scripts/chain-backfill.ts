/**
 * One-off: rebuild the tape from chain for every market the radar tracks whose API tape is shorter than
 * the on-chain trade count, cache each under sonar:chaintape:<id>, then re-run the replay.
 *   npx tsx scripts/chain-backfill.ts            # all short tapes
 *   npx tsx scripts/chain-backfill.ts --dry      # only report what would be fetched
 * Reads the store named by .env.local (Upstash in production, the JSON file locally).
 */
import { config as dotenv } from 'dotenv';
dotenv({ path: '.env.local' }); dotenv();
import { fetchChainTape, tapeIsShort, type ChainTapeCache } from '../src/lib/chain-tape';
import { runBacktest } from '../src/lib/backtest';
import { CHAIN_TAPE_KEY, readRadar } from '../src/lib/radar';
import { store } from '../src/lib/store';

const dry = process.argv.includes('--dry');
(async () => {
  const radar = await readRadar();
  if (!radar) { console.error('no radar in the store; run a snapshot first'); process.exit(1); }
  const s = store();
  const todo = radar.markets.filter((m) => tapeIsShort(m.tape, m.detail.onChain?.totalTrades));
  console.log(`${radar.markets.length} markets on the radar, ${todo.length} with a tape shorter than the chain count`);
  let fetched = 0, prints = 0;
  for (const m of todo) {
    const id = m.detail.marketId;
    const have = await s.get<ChainTapeCache>(CHAIN_TAPE_KEY(id));
    if (have?.complete && m.detail.phase === 'resolved') { console.log(`  cached   ${id.slice(0, 8)} ${have.trades.length} prints`); continue; }
    if (dry) { console.log(`  would    ${id.slice(0, 8)} api ${m.tape.length} / chain ${m.detail.onChain?.totalTrades}  ${(m.detail.title || m.detail.question || '').slice(0, 50)}`); continue; }
    const t0 = Date.now();
    try {
      const c = await fetchChainTape(id);
      await s.set(CHAIN_TAPE_KEY(id), c, m.detail.phase === 'resolved' ? 90 * 86400 : 7 * 86400);
      fetched++; prints += c.trades.length;
      console.log(`  fetched  ${id.slice(0, 8)} ${c.trades.length} prints from ${c.signatures} sigs in ${((Date.now() - t0) / 1000).toFixed(0)}s (api had ${m.tape.length}, chain says ${m.detail.onChain?.totalTrades})  ${(m.detail.title || m.detail.question || '').slice(0, 40)}`);
    } catch (e) { console.log(`  FAILED   ${id.slice(0, 8)} ${(e as Error).message}`); }
  }
  console.log(`fetched ${fetched} tapes, ${prints} prints`);
  if (!dry) {
    const b = await runBacktest();
    console.log(`replay: ${b.markets} markets, ${b.calls} calls, ${b.hits} hits (${b.hitRate === null ? '–' : Math.round(b.hitRate * 100) + '%'}), ${b.flat} flat, ${b.chainTapes} chain tapes, pnl/USDC ${b.pnlPerUsdc?.toFixed(2)}`, b.byConfidence);
    if (b.errors?.length) console.log('errors:', b.errors.slice(0, 5));
  }
})();
