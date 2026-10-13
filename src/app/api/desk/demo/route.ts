import { NextRequest, NextResponse } from 'next/server';
import { publicBrief, settleDemo } from '@/lib/desk';
import { payFail } from '../../pay/_err';
export const dynamic = 'force-dynamic';

/**
 * Sandbox demo settlement: { briefId, outcome? } settles one paid brief as if its market resolved (against the call by
 * default) and refunds it through PayPal. Marked demo, never counted in the guarantee record. Authorization: Bearer DESK_SECRET.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.DESK_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { briefId?: unknown; outcome?: unknown };
  const outcome = body.outcome === 'YES' || body.outcome === 'NO' || body.outcome === 'CANCELLED' ? body.outcome : undefined;
  if (typeof body.briefId !== 'string' || (body.outcome !== undefined && !outcome)) return NextResponse.json({ error: 'BAD_REQUEST', message: 'briefId required; outcome is YES, NO or CANCELLED' }, { status: 400 });
  try { return NextResponse.json({ brief: publicBrief(await settleDemo(body.briefId, outcome)) }); } catch (e) { return payFail(e); }
}
