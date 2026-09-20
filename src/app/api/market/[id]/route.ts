import { NextResponse } from 'next/server';
import { getMarket, getMarketTrades, isTradable, marketYesPrice } from '@/lib/panta';
import { readMarket, readSnapshots } from '@/lib/radar';
import { computeSignals } from '@/lib/signals';
import { fail, isPubkey } from '../../_util';

export const dynamic = 'force-dynamic';
export async function GET(_: Request, { params }: { params: { id: string } }) {
  if (!isPubkey(params.id)) return NextResponse.json({ error: 'BAD_ID' }, { status: 400 });
  try {
    const [cached, snaps] = await Promise.all([readMarket(params.id), readSnapshots(params.id)]);
    // Always fetch a fresh detail + tape so the page reflects the chain, but reuse the venue match from the radar.
    const [detail, tape] = await Promise.all([getMarket(params.id), getMarketTrades(params.id, 200).then((r) => r.items).catch(() => cached?.tape ?? [])]);
    const now = Date.now() / 1000;
    const yesPrice = marketYesPrice(detail);
    const venue = cached?.venue ?? null;
    const signals = computeSignals(detail, tape, snaps, yesPrice, venue, now);
    return NextResponse.json({ detail, yesPrice, tape, signals, venue, tradable: isTradable(detail, now), snapshots: snaps, updatedAt: now }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return fail(e); }
}
