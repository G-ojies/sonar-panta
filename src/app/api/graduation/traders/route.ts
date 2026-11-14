import { NextResponse } from 'next/server';
import { readTraders } from '@/lib/grad-traders-server';
import { fail } from '../../_util';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/graduation/traders
 * Outside wallets that have traded the graduation markets on devnet, read from chain: totals and the top 50 by
 * trades. The Sonar keeper and test wallets are not counted. Refreshed at most every two minutes.
 */
export async function GET() {
  try {
    return NextResponse.json(await readTraders(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return fail(e); }
}
