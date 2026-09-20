import { NextResponse } from 'next/server';
import { quoteBuy } from '@/lib/panta';
import { fail, isPubkey } from '../../_util';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  if (!isPubkey(b.wallet) || !isPubkey(b.marketId) || !['yes', 'no'].includes(b.side)) return NextResponse.json({ error: 'BAD_INPUT' }, { status: 400 });
  const amt = Number(b.amountUsdc);
  if (!(amt > 0 && amt <= 10_000)) return NextResponse.json({ error: 'BAD_AMOUNT' }, { status: 400 });
  try { return NextResponse.json(await quoteBuy({ wallet: b.wallet, marketId: b.marketId, side: b.side, amountUsdc: amt.toFixed(2), userId: `sonar:${b.wallet}` })); }
  catch (e) { return fail(e); }
}
