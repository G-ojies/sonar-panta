import { NextRequest, NextResponse } from 'next/server';
import { openBrief } from '@/lib/desk';
import { payFail } from '../_err';
export const dynamic = 'force-dynamic';

/** POST { marketId } -> a PayPal order for one brief. The price is set here, never by the browser. */
export async function POST(req: NextRequest) {
  try {
    const { marketId } = (await req.json().catch(() => ({}))) as { marketId?: string };
    if (!marketId || typeof marketId !== 'string') return NextResponse.json({ error: 'BAD_REQUEST', message: 'marketId required' }, { status: 400 });
    const r = await openBrief(marketId);
    return NextResponse.json({ orderId: r.orderId, approveUrl: r.approveUrl, briefId: r.brief.id, call: { side: r.brief.call.side }, priceCents: r.brief.priceCents });
  } catch (e) { return payFail(e); }
}
