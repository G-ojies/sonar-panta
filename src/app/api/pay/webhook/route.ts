import { NextRequest, NextResponse } from 'next/server';
import { onPayPalEvent, paypal } from '@/lib/desk';
import { payFail } from '../_err';
export const dynamic = 'force-dynamic';

/** PayPal webhooks. The signature is checked with PayPal before anything is trusted. */
export async function POST(req: NextRequest) {
  try {
    const raw = await req.text();
    const pp = paypal();
    if (!(await pp.verifyWebhook(req.headers, raw))) return NextResponse.json({ error: 'BAD_SIGNATURE' }, { status: 400 });
    const ev = JSON.parse(raw) as { id?: string; event_type?: string; resource?: Record<string, unknown> };
    return NextResponse.json({ ok: true, event: ev.event_type, did: await onPayPalEvent(ev, pp) });
  } catch (e) { return payFail(e); }
}
