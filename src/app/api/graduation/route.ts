import { NextRequest, NextResponse } from 'next/server';
import { readGrad } from '@/lib/grad-market-server';
import { fail, isPubkey } from '../_util';

export const dynamic = 'force-dynamic';

/**
 * GET /api/graduation?user=<wallet>&fresh=1
 * Every pm-AMM graduation market the grad_resolver program holds on devnet: the binding, the pm-AMM market and its
 * YES price, the pool's progress, the vault and the creator fees, plus the caller's mUSDC and outcome tokens when
 * `user` is given. Served from a 20 s cache unless `fresh=1`. See docs/HACKATHON-PERPS-PM.md.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const user = q.get('user') ?? undefined;
  if (user !== undefined && !isPubkey(user)) return NextResponse.json({ error: 'BAD_ADDRESS', message: 'user is not a public key' }, { status: 400 });
  try {
    return NextResponse.json(await readGrad({ user, fresh: q.get('fresh') === '1' }), { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return fail(e); }
}
