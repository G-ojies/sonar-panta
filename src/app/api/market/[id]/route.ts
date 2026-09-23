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
    let stale = false;
    const [detail, tape] = await Promise.all([
      getMarket(params.id).catch((e) => { if (!cached) throw e; stale = true; return cached.detail; }), // transient Panta failure: serve the last scan
      getMarketTrades(params.id, 200).then((r) => r.items).catch(() => cached?.tape ?? []),
    ]);
    const now = Date.now() / 1000;
    // Panta's detail endpoint sometimes returns a stripped row (blank title, no onChain state).
    // Fill blanks from the last scan so the page never loses the question, rule or chain state.
    if (cached) {
      for (const [k, v] of Object.entries(cached.detail)) {
        const cur = (detail as unknown as Record<string, unknown>)[k];
        if (cur === undefined || cur === null || cur === '' || (Array.isArray(cur) && cur.length === 0 && Array.isArray(v) && v.length)) (detail as unknown as Record<string, unknown>)[k] = v;
      }
    }
    const yesPrice = marketYesPrice(detail);
    const venue = cached?.venue ?? null;
    const signals = computeSignals(detail, tape, snaps, yesPrice, venue, now);
    return NextResponse.json({ detail, yesPrice, tape, signals, venue, tradable: isTradable(detail, now), snapshots: snaps, updatedAt: stale ? cached!.updatedAt : now, stale }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return fail(e); }
}
