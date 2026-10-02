import { NextRequest, NextResponse } from 'next/server';
import { readMarkets } from '@/lib/curve-market-server';
import { fail, isPubkey } from '../../_util';

export const dynamic = 'force-dynamic';

/**
 * GET /api/curve/markets?pool=<address>&user=<wallet>&fresh=1
 * The graduation markets the curve_market program holds, read from the cluster it is deployed on (devnet for now),
 * all of them or those on one pool, with the caller's positions when `user` is given. Served from a 20 s cache
 * unless `fresh=1`, which a page passes right after it sent a transaction. See docs/CURVE.md.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const pool = q.get('pool') ?? undefined, user = q.get('user') ?? undefined;
  if (pool !== undefined && !isPubkey(pool)) return NextResponse.json({ error: 'BAD_ADDRESS', message: 'pool is not a public key' }, { status: 400 });
  if (user !== undefined && !isPubkey(user)) return NextResponse.json({ error: 'BAD_ADDRESS', message: 'user is not a public key' }, { status: 400 });
  try {
    const r = await readMarkets({ pool, user, fresh: q.get('fresh') === '1' });
    return NextResponse.json(r, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return fail(e); }
}
