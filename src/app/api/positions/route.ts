import { NextRequest, NextResponse } from 'next/server';
import { getMarket, getPositions, marketYesPrice } from '@/lib/panta';
import { fail, isPubkey, modeOf } from '../_util';

export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get('wallet');
  if (!isPubkey(wallet)) return NextResponse.json({ error: 'BAD_WALLET' }, { status: 400 });
  try {
    const mode = modeOf({ sandbox: req.nextUrl.searchParams.get('sandbox') ?? undefined });
    const p = await getPositions(wallet, mode);
    const ids = [...new Set(p.positions.map((x) => x.marketId))];
    const details = Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await getMarket(id).catch(() => null)] as const)));
    const rows = p.positions.map((pos) => {
      const d = details[pos.marketId];
      const yes = d ? marketYesPrice(d) : null;
      const shares = Number(pos.shares);
      let value: number | null = null;
      if (pos.outcome) value = pos.outcome === pos.side ? shares : 0;
      else if (yes !== null) value = shares * (pos.side === 'yes' ? yes : 1 - yes);
      return { ...pos, title: d?.title || d?.question || '', yesPrice: yes, value, endTime: d?.endTime ?? null };
    });
    return NextResponse.json({ wallet, summary: p.summary ?? null, positions: rows }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return fail(e); }
}
