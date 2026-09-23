import { NextResponse } from 'next/server';
import { buildClaim, buildCreatorFees } from '@/lib/panta';
import { fail, isPubkey, modeOf } from '../../_util';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  if (!isPubkey(b.wallet) || !isPubkey(b.marketId)) return NextResponse.json({ error: 'BAD_INPUT' }, { status: 400 });
  try {
    const r = b.kind === 'creator-fees' ? await buildCreatorFees({ wallet: b.wallet, marketId: b.marketId }, modeOf(b)) : await buildClaim({ wallet: b.wallet, marketId: b.marketId }, modeOf(b));
    return NextResponse.json(r);
  } catch (e) { return fail(e); }
}
