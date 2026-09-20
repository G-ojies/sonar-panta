/* One radar refresh from the CLI: `npm run snapshot` */
import { config as dotenv } from 'dotenv';
dotenv({ path: '.env.local' }); dotenv();
import { refreshRadar } from '../src/lib/radar';
import { storeKind } from '../src/lib/store';

async function main() {
  console.log(`store=${storeKind()} base=${process.env.PANTA_API_BASE_URL}`);
  const r = await refreshRadar({ venues: process.argv.includes('--no-venues') ? false : true });
  console.log(`scanned=${r.scanned} kept=${r.markets.length} errors=${r.errors.length} in ${r.durationMs}ms`);
  for (const e of r.errors.slice(0, 8)) console.log('  !', e);
  for (const m of r.markets.slice(0, 25)) {
    const d = m.detail, s = m.signals;
    console.log(
      `${m.tradable ? 'LIVE ' : d.onChain?.isActive ? 'open ' : '     '}${String(s.score).padStart(4)} ${s.side.padEnd(4)} ${s.confidence.padEnd(6)} ` +
      `y=${m.yesPrice === null ? ' -- ' : (m.yesPrice * 100).toFixed(0).padStart(3) + '¢'} tape=${String(m.tape.length).padStart(3)} ` +
      `${m.venue ? `${m.venue.venue[0]}=${(m.venue.yesPrice * 100).toFixed(0)}¢(${m.venue.similarity.toFixed(2)})` : '        '} ` +
      `${d.phase.padEnd(9)} ${(d.title || d.question || '').slice(0, 60)}`,
    );
    if (s.reasons.length) console.log(`         ↳ ${s.reasons.join(' · ')}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
