import { NextResponse } from 'next/server';
import { getAccount } from '@/lib/panta';
import { readRadar, readRefreshLog } from '@/lib/radar';
import { storeKind } from '@/lib/store';

export const dynamic = 'force-dynamic';
export async function GET() {
  const [radar, log] = await Promise.all([readRadar(), readRefreshLog()]);
  let panta: string = 'unknown';
  try { const a = await getAccount(); panta = `ok:${a.status}`; } catch (e) { panta = `error:${(e as Error).message}`; }
  return NextResponse.json({
    ok: true, store: storeKind(), panta, radarUpdatedAt: radar?.updatedAt ?? null, radarMarkets: radar?.markets.length ?? 0,
    lastRefresh: log[0] ?? null, cluster: process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? 'mainnet-beta',
  });
}
