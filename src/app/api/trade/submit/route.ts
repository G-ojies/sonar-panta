import { NextResponse } from 'next/server';
import { submitBuy, verifyBuy } from '@/lib/panta';
import { fail, modeOf } from '../../_util';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  if (typeof b.orderId !== 'string' || typeof b.signature !== 'string') return NextResponse.json({ error: 'BAD_INPUT' }, { status: 400 });
  try {
    const sub = await submitBuy({ orderId: b.orderId, signature: b.signature }, modeOf(b));
    const ver = await verifyBuy({ orderId: b.orderId, signature: b.signature }, modeOf(b)).catch(() => null);
    return NextResponse.json({ submit: sub, verify: ver });
  } catch (e) { return fail(e); }
}
