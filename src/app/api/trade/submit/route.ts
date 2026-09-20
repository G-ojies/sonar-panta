import { NextResponse } from 'next/server';
import { submitBuy, verifyBuy } from '@/lib/panta';
import { fail } from '../../_util';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  if (typeof b.orderId !== 'string' || typeof b.signature !== 'string') return NextResponse.json({ error: 'BAD_INPUT' }, { status: 400 });
  try {
    const sub = await submitBuy({ orderId: b.orderId, signature: b.signature });
    const ver = await verifyBuy({ orderId: b.orderId, signature: b.signature }).catch(() => null);
    return NextResponse.json({ submit: sub, verify: ver });
  } catch (e) { return fail(e); }
}
