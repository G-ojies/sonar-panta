import { NextResponse } from 'next/server';
import { buildBuy } from '@/lib/panta';
import { fail, isPubkey, modeOf } from '../../_util';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  if (!isPubkey(b.wallet) || typeof b.quoteId !== 'string') return NextResponse.json({ error: 'BAD_INPUT' }, { status: 400 });
  const slip = Math.min(5000, Math.max(10, Number(b.maxSlippageBps ?? 150)));
  try { return NextResponse.json(await buildBuy({ quoteId: b.quoteId, wallet: b.wallet, maxSlippageBps: slip, userId: `sonar:${b.wallet}` }, modeOf(b))); }
  catch (e) { return fail(e); }
}
