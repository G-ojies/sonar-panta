import { NextRequest, NextResponse } from 'next/server';
import { captureBrief, publicBrief } from '@/lib/desk';
import { payFail } from '../_err';
export const dynamic = 'force-dynamic';

/** POST { orderId } after the buyer approves in PayPal: capture, then return the written brief. */
export async function POST(req: NextRequest) {
  try {
    const { orderId } = (await req.json().catch(() => ({}))) as { orderId?: string };
    if (!orderId || typeof orderId !== 'string') return NextResponse.json({ error: 'BAD_REQUEST', message: 'orderId required' }, { status: 400 });
    const { brief, text } = await captureBrief(orderId);
    return NextResponse.json({ brief: publicBrief(brief), text });
  } catch (e) { return payFail(e); }
}
