/* Copy the local file store (.sonar-store.json) into Upstash so a fresh deployment starts
 * with the snapshots, backtest and agent history collected locally:
 *   KV_REST_API_URL=... KV_REST_API_TOKEN=... npx tsx scripts/store-sync.ts [file]
 */
import { config as dotenv } from 'dotenv';
dotenv({ path: '.env.local' }); dotenv();
import { readFileSync } from 'fs';
import { Redis } from '@upstash/redis';

async function main() {
  const file = process.argv[2] ?? process.env.SONAR_STORE_FILE ?? '.sonar-store.json';
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('KV_REST_API_URL / KV_REST_API_TOKEN not set');
  const j = JSON.parse(readFileSync(file, 'utf8')) as { kv: Record<string, { v: unknown; exp?: number }>; lists: Record<string, unknown[]> };
  const r = new Redis({ url, token });
  const now = Date.now();
  let n = 0;
  for (const [k, c] of Object.entries(j.kv)) {
    if (c.exp && c.exp < now) continue;
    if (c.exp) await r.set(k, c.v, { ex: Math.ceil((c.exp - now) / 1000) }); else await r.set(k, c.v);
    n++;
  }
  for (const [k, l] of Object.entries(j.lists)) {
    await r.del(k);
    if (l.length) await r.rpush(k, ...(l as never[]));
    n++;
  }
  console.log(`synced ${n} keys from ${file} to Upstash`);
}
main().catch((e) => { console.error(e); process.exit(1); });
