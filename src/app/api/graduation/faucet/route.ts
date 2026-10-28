import { NextRequest, NextResponse } from 'next/server';
import { PM_FAUCET } from '@/lib/grad-market';
import { isPubkey } from '../../_util';

export const dynamic = 'force-dynamic';

/**
 * POST /api/graduation/faucet {"wallet": "<pubkey>"}
 * Passes the request to pm-AMM's devnet faucet (test mUSDC and a little devnet SOL), so the page can offer it with one
 * click. Nothing here has real value.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { wallet?: unknown } | null;
  if (!isPubkey(body?.wallet)) return NextResponse.json({ error: 'BAD_ADDRESS', message: 'wallet is not a public key' }, { status: 400 });
  try {
    const res = await fetch(PM_FAUCET, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wallet: body!.wallet }), cache: 'no-store' });
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json(j, { status: res.ok ? 200 : res.status });
  } catch {
    return NextResponse.json({ error: 'FAUCET_DOWN', message: 'The pm-AMM faucet did not answer. Try again in a minute.' }, { status: 502 });
  }
}
