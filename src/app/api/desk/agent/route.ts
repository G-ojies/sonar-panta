import { NextRequest, NextResponse } from 'next/server';
import type { CoreMessage } from 'ai';
import { parseMandate } from '@/lib/mandate';
import { runShopper } from '@/lib/shopper';
import { payFail } from '../../pay/_err';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** POST { session, mandate, messages } -> the agent's reply, the tools it used and the PayPal approvals it opened. */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { session?: unknown; mandate?: unknown; messages?: unknown };
    const session = typeof body.session === 'string' && /^[\w-]{8,64}$/.test(body.session) ? body.session : null;
    if (!session) return NextResponse.json({ error: 'BAD_REQUEST', message: 'session required' }, { status: 400 });
    const messages = (Array.isArray(body.messages) ? body.messages : [])
      .filter((m): m is { role: 'user' | 'assistant'; content: string } => !!m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }) as CoreMessage);
    if (!messages.length) return NextResponse.json({ error: 'BAD_REQUEST', message: 'messages required' }, { status: 400 });
    const origin = process.env.DESK_BASE_URL ?? req.nextUrl.origin;
    const reply = await runShopper({ session, mandate: parseMandate(body.mandate), messages, returnUrl: `${origin}/desk/return` });
    return NextResponse.json(reply);
  } catch (e) { return payFail(e); }
}
