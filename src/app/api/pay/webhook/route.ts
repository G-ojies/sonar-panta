import { NextRequest, NextResponse } from 'next/server';
import { onPayPalEvent, paypal } from '@/lib/desk';
import { store } from '@/lib/store';
import { payFail } from '../_err';
export const dynamic = 'force-dynamic';

const LOG = 'desk:webhook-log';
interface LogRow { at: number; event: string; verified: boolean; did?: string; error?: string }
const log = (r: LogRow) => store().lpush(LOG, r, 50).catch(() => {});

/** PayPal webhooks. The signature is checked with PayPal before anything is trusted. */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  let event = 'unknown';
  try {
    const ev = JSON.parse(raw) as { id?: string; event_type?: string; resource?: Record<string, unknown> };
    event = ev.event_type ?? 'unknown';
    const pp = paypal();
    if (!(await pp.verifyWebhook(req.headers, raw))) { await log({ at: Date.now() / 1000, event, verified: false }); return NextResponse.json({ error: 'BAD_SIGNATURE' }, { status: 400 }); }
    const did = await onPayPalEvent(ev, pp);
    await log({ at: Date.now() / 1000, event, verified: true, did });
    return NextResponse.json({ ok: true, event, did });
  } catch (e) {
    await log({ at: Date.now() / 1000, event, verified: false, error: (e as Error).message.slice(0, 200) });
    return payFail(e);
  }
}

/** The last webhook deliveries: event type, time, whether the signature checked out. No payment details. */
export async function GET() {
  return NextResponse.json({ deliveries: await store().lrange<LogRow>(LOG, 0, 19) }, { headers: { 'Cache-Control': 'no-store' } });
}
