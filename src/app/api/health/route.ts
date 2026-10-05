import { NextResponse } from 'next/server';
import { getAccount } from '@/lib/panta';
import { readRefreshLog } from '@/lib/radar';
import { storeKind } from '@/lib/store';
import { chainHealth } from '@/lib/tape-stream';

export const dynamic = 'force-dynamic';

// The host calls this every few seconds. Panta is asked at most once in five minutes.
let pantaSeen: { at: number; status: string } | null = null;
async function pantaStatus(): Promise<string> {
  if (pantaSeen && Date.now() - pantaSeen.at < 5 * 60_000) return pantaSeen.status;
  let status: string;
  try { const a = await getAccount(); status = `ok:${a.status}`; } catch (e) { status = `error:${(e as Error).message}`; }
  pantaSeen = { at: Date.now(), status };
  return status;
}

export async function GET() {
  // The radar is about 1 MB; reading it here once a minute was most of the host's monthly bandwidth.
  // The refresh log row written with each scan carries the same time and market count.
  const [log, panta] = await Promise.all([readRefreshLog(), pantaStatus()]);
  // The first call after boot starts the live tape stream, so the host's own health check is what brings it up.
  return NextResponse.json({
    ok: true, store: storeKind(), panta, radarUpdatedAt: log[0]?.ts ?? null, radarMarkets: log[0]?.kept ?? 0,
    lastRefresh: log[0] ?? null, cluster: process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? 'mainnet-beta',
    chain: chainHealth(),
  });
}
