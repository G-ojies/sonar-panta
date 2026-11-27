import { NextRequest, NextResponse } from 'next/server';
import { PM_FAUCET } from '@/lib/grad-market';
import { dripSol } from '@/lib/grad-drip';
import { isPubkey } from '../../_util';

export const dynamic = 'force-dynamic';

/**
 * POST /api/graduation/faucet {"wallet": "<pubkey>"}
 * Passes the request to pm-AMM's devnet faucet (test mUSDC and a little devnet SOL), so the page can offer it with one
 * click. When pm-AMM skips the SOL (its reserve runs dry), a small devnet SOL top-up from our own devnet wallet
 * follows so a brand-new wallet can still pay fees. Nothing here has real value.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { wallet?: unknown } | null;
  if (!isPubkey(body?.wallet)) return NextResponse.json({ error: 'BAD_ADDRESS', message: 'wallet is not a public key' }, { status: 400 });
  try {
    const res = await fetch(PM_FAUCET, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wallet: body!.wallet }), cache: 'no-store' });
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const drip = Number(j.sol ?? 0) > 0 ? null : await dripSol(body!.wallet as string).catch(() => null);
    if (!res.ok && drip?.dripSol) return NextResponse.json({ ...j, ...drip, ok: true, message: 'Sent devnet SOL for fees; the mUSDC faucet refused, try it again later.' });
    return NextResponse.json(drip ? { ...j, ...drip } : j, { status: res.ok ? 200 : res.status });
  } catch {
    const drip = await dripSol(body!.wallet as string).catch(() => null);
    if (drip?.dripSol) return NextResponse.json({ ok: true, ...drip, message: 'Sent devnet SOL for fees; the mUSDC faucet did not answer, try it again in a minute.' });
    return NextResponse.json({ error: 'FAUCET_DOWN', message: 'The pm-AMM faucet did not answer. Try again in a minute.' }, { status: 502 });
  }
}
