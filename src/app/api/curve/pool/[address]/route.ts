import { NextResponse } from 'next/server';
import { readPool } from '@/lib/curve';
import { readMarkets } from '@/lib/curve-market-server';
import { DBC_PROGRAM } from '@/lib/dbc';
import { fail, isPubkey } from '../../../_util';

export const dynamic = 'force-dynamic';

/**
 * GET /api/curve/pool/[address]
 * One DBC pool with its tape (newest print first). A pool the index does not know is read live from its account and
 * followed from the next refresh on; the tape is filled on demand inside a budget. 404 when the address is not a
 * VirtualPool. `markets` carries the pool's graduation markets (null when the market read failed; the page then polls
 * /api/curve/markets itself). See docs/CURVE.md.
 */
export async function GET(_: Request, { params }: { params: { address: string } }) {
  if (!isPubkey(params.address)) return NextResponse.json({ error: 'BAD_ADDRESS' }, { status: 400 });
  try {
    const r = await readPool(params.address);
    if (!r) return NextResponse.json({ error: 'NOT_A_POOL', message: `${params.address} is not a Meteora DBC VirtualPool` }, { status: 404 });
    const markets = await readMarkets({ pool: params.address }).catch(() => null);
    return NextResponse.json({ program: DBC_PROGRAM, pool: r.pool, tape: r.tape?.prints ?? [], tapeUpdatedAt: r.tape?.ts ?? null, tapeComplete: r.tape?.complete ?? false, fresh: r.fresh, markets }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return fail(e); }
}
