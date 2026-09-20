import { NextResponse } from 'next/server';
import { readRadar } from '@/lib/radar';

export const dynamic = 'force-dynamic';
export async function GET() {
  const r = await readRadar();
  if (!r) return NextResponse.json({ updatedAt: null, markets: [], scanned: 0, errors: ['radar has not run yet'] }, { headers: { 'Cache-Control': 'no-store' } });
  // trim tapes for the list payload
  const markets = r.markets.map((m) => ({ ...m, tape: m.tape.slice(0, 5) }));
  return NextResponse.json({ ...r, markets }, { headers: { 'Cache-Control': 's-maxage=30, stale-while-revalidate=120' } });
}
