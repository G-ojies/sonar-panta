/* One curve refresh with every outbound request counted by host: `npx tsx scripts/measure-curve.ts` */
import { config as dotenv } from 'dotenv';
dotenv({ path: '.env.local' }); dotenv();

const sent: Record<string, { n: number; up: number; down: number; wire: number }> = {};
const real = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  const row = (sent[url.host] ??= { n: 0, up: 0, down: 0, wire: 0 });
  row.n += 1;
  row.up += typeof init?.body === 'string' ? Buffer.byteLength(init.body) : 0;
  const res = await real(input, init);
  // JSON bytes after decompression; the provider compresses (brotli), so the wire is about a third of that
  const copy = res.clone();
  void copy.arrayBuffer().then((b) => { row.down += b.byteLength; row.wire += Number(res.headers.get('content-length')) || Math.round(b.byteLength / 3); }).catch(() => {});
  return res;
}) as typeof fetch;

async function main() {
  const { refreshCurve, rankPools } = await import('../src/lib/curve');
  const { storeKind } = await import('../src/lib/store');
  const r = await refreshCurve();
  await new Promise((r) => setTimeout(r, 1500));
  const pools = rankPools(Object.values(r.pools));
  console.log(`store=${storeKind()} slot=${r.slot} sample=${JSON.stringify(r.sample)} kept=${pools.length} errors=${r.errors.length} in ${(r.durationMs / 1000).toFixed(0)} s`);
  for (const e of r.errors.slice(0, 5)) console.log('  error:', e);
  for (const p of pools.slice(0, 12)) console.log(`  ${p.address} ${p.status.padEnd(8)} ${String(p.progressPct ?? '-').padStart(6)}% ${p.quoteRaised.toFixed(2)}/${p.threshold} ${p.quote.symbol} price ${p.price?.toExponential(3)} prints ${p.prints} found by ${p.foundBy}`);
  const mb = (n: number) => (n / 1e6).toFixed(2).padStart(7);
  let up = 0, down = 0, wire = 0;
  for (const [host, v] of Object.entries(sent).sort((a, b) => (b[1].up + b[1].down) - (a[1].up + a[1].down))) {
    console.log(`${host.padEnd(44)} ${String(v.n).padStart(5)} requests  up ${mb(v.up)} MB  down ${mb(v.down)} MB json  (~${mb(v.wire)} MB on the wire)`);
    up += v.up; down += v.down; wire += v.wire;
  }
  console.log(`${'total'.padEnd(44)} ${''.padStart(5)}           up ${mb(up)} MB  down ${mb(down)} MB json  (~${mb(wire)} MB on the wire)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
