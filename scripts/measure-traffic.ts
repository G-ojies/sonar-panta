/* One radar refresh with every outbound request counted by host: `npx tsx scripts/measure-traffic.ts` */
import { config as dotenv } from 'dotenv';
dotenv({ path: '.env.local' }); dotenv();

const sent: Record<string, { n: number; up: number; down: number }> = {};
const real = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  const row = (sent[url.host] ??= { n: 0, up: 0, down: 0 });
  row.n += 1;
  row.up += typeof init?.body === 'string' ? Buffer.byteLength(init.body) : 0;
  const res = await real(input, init);
  // bytes after decompression: an upper bound on what crossed the wire
  const copy = res.clone();
  void copy.arrayBuffer().then((b) => { row.down += b.byteLength; }).catch(() => {});
  return res;
}) as typeof fetch;

async function main() {
  const { refreshRadar } = await import('../src/lib/radar');
  const { storeKind } = await import('../src/lib/store');
  const r = await refreshRadar({ venues: !process.argv.includes('--no-venues') });
  await new Promise((r) => setTimeout(r, 1500));
  console.log(`store=${storeKind()} scanned=${r.scanned} kept=${r.markets.length} errors=${r.errors.length} in ${(r.durationMs / 1000).toFixed(0)} s`);
  const mb = (n: number) => (n / 1e6).toFixed(2).padStart(7);
  let up = 0, down = 0;
  for (const [host, v] of Object.entries(sent).sort((a, b) => (b[1].up + b[1].down) - (a[1].up + a[1].down))) {
    console.log(`${host.padEnd(44)} ${String(v.n).padStart(5)} requests  up ${mb(v.up)} MB  down ${mb(v.down)} MB`);
    up += v.up; down += v.down;
  }
  console.log(`${'total'.padEnd(44)} ${''.padStart(5)}           up ${mb(up)} MB  down ${mb(down)} MB`);
}
main().catch((e) => { console.error(e); process.exit(1); });
