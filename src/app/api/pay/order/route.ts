import { NextRequest, NextResponse } from 'next/server';
import { openBrief, openProBrief, publicBrief } from '@/lib/desk';
import { payFail } from '../_err';
export const dynamic = 'force-dynamic';

/** POST { marketId, subscriptionId? } -> a PayPal order for one brief, or the brief at once for Sonar Pro. The price is set here, never by the browser. */
export async function POST(req: NextRequest) {
  try {
    const { marketId, subscriptionId } = (await req.json().catch(() => ({}))) as { marketId?: string; subscriptionId?: string };
    if (!marketId || typeof marketId !== 'string') return NextResponse.json({ error: 'BAD_REQUEST', message: 'marketId required' }, { status: 400 });
    // Sonar Pro members skip checkout: the subscription covers the brief
    if (typeof subscriptionId === 'string' && subscriptionId) {
      const r = await openProBrief(marketId, subscriptionId);
      return NextResponse.json({ orderId: r.brief.orderId, pro: true, brief: publicBrief(r.brief), text: r.text });
    }
    const r = await openBrief(marketId);
    return NextResponse.json({ orderId: r.orderId, approveUrl: r.approveUrl, briefId: r.brief.id, call: { side: r.brief.call.side }, priceCents: r.brief.priceCents });
  } catch (e) { return payFail(e); }
}
