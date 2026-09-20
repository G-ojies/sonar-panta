import { config as dotenv } from 'dotenv';
dotenv({ path: '.env.local' }); dotenv();
import { runBacktest } from '../src/lib/backtest';
runBacktest({ frac: Number(process.env.FRAC ?? 0.6) }).then((b) => {
  console.log(`markets=${b.markets} calls=${b.calls} hits=${b.hits} hitRate=${b.hitRate === null ? '-' : (b.hitRate * 100).toFixed(1) + '%'} flat=${b.flat} pnl/usdc=${b.pnlPerUsdc?.toFixed(3)}`);
  console.log('byConfidence', b.byConfidence);
  if (b.errors?.length) { console.log(`errors=${b.errors.length}`); for (const e of b.errors.slice(0, 5)) console.log('  !', e); }
  for (const r of b.rows.slice(0, 30)) console.log(`${r.hit === null ? '  ·' : r.hit ? ' ✓ ' : ' ✗ '} ${String(r.score).padStart(4)} ${r.side.padEnd(4)} ${r.confidence.padEnd(6)} out=${r.outcome} px=${((r.yesPriceAtCall ?? 0) * 100).toFixed(0)}¢ tape=${r.tapeSize} ${r.title.slice(0, 60)}`);
}).catch((e) => { console.error(e); process.exit(1); });
