import { NextRequest, NextResponse } from 'next/server';
import { curveEnabled, rankPools, readCurve, readCurveLog } from '@/lib/curve';
import { DBC_PROGRAM } from '@/lib/dbc';

export const dynamic = 'force-dynamic';

/**
 * GET /api/curve/launches?status=trading|complete|migrated&limit=50
 * The Meteora DBC pools Sonar follows, trading pools nearest graduation first. Each row carries its last five prints;
 * /api/curve/pool/[address] has the whole tape. See docs/CURVE.md.
 */
export async function GET(req: NextRequest) {
  const idx = await readCurve();
  const headers = { 'Cache-Control': 's-maxage=30, stale-while-revalidate=120' };
  if (!idx) return NextResponse.json({ program: DBC_PROGRAM, updatedAt: null, slot: null, sample: null, pools: [], note: curveEnabled() ? 'the curve index has not run yet' : 'the curve index is off (SONAR_CURVE=off)' }, { headers: { 'Cache-Control': 'no-store' } });
  const status = req.nextUrl.searchParams.get('status');
  const limit = Math.min(500, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 100));
  const pools = rankPools(Object.values(idx.pools)).filter((p) => !status || p.status === status).slice(0, limit);
  const log = await readCurveLog().catch(() => []);
  return NextResponse.json({ program: DBC_PROGRAM, updatedAt: idx.updatedAt, slot: idx.slot, sample: idx.sample, kept: Object.keys(idx.pools).length, pools, errors: idx.errors, lastRefreshes: log.slice(0, 5) }, { headers });
}
