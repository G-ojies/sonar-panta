import { NextResponse } from 'next/server';
import { getAccount } from '@/lib/panta';
import { readRadar, readRefreshLog } from '@/lib/radar';
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
  const [radar, log, panta] = await Promise.all([readRadar(), readRefreshLog(), pantaStatus()]);
  // The first call after boot starts the live tape stream, so the host's own health check is what brings it up.
  return NextResponse.json({
    ok: true, store: storeKind(), panta, radarUpdatedAt: radar?.updatedAt ?? null, radarMarkets: radar?.markets.length ?? 0,
    lastRefresh: log[0] ?? null, cluster: process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? 'mainnet-beta',
    chain: chainHealth(),
  });
}
