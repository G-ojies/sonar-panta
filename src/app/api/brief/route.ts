import { NextRequest, NextResponse } from 'next/server';
import { briefByOrder, publicBrief, readBriefText } from '@/lib/desk';
import { payFail } from '../pay/_err';
export const dynamic = 'force-dynamic';

/** GET ?order=<PayPal order id>: the order id is the buyer's receipt, so it unlocks their brief. */
export async function GET(req: NextRequest) {
  try {
    const order = req.nextUrl.searchParams.get('order');
    if (!order) return NextResponse.json({ error: 'BAD_REQUEST', message: 'order required' }, { status: 400 });
    const b = await briefByOrder(order);
    if (!b) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    const text = b.status === 'pending' ? null : await readBriefText(b.id);
    return NextResponse.json({ brief: publicBrief(b), text }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return payFail(e); }
}
