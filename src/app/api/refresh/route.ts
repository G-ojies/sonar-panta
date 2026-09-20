import { NextRequest, NextResponse } from 'next/server';
import { refreshRadar } from '@/lib/radar';
import { fail } from '../_util';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Called by Vercel Cron (Authorization: Bearer CRON_SECRET) or manually with ?key= */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  const key = req.nextUrl.searchParams.get('key');
  if (secret && auth !== `Bearer ${secret}` && key !== secret) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  try {
    const r = await refreshRadar({ venues: req.nextUrl.searchParams.get('venues') !== '0' });
    return NextResponse.json({ ok: true, scanned: r.scanned, kept: r.markets.length, errors: r.errors.length, durationMs: r.durationMs });
  } catch (e) { return fail(e); }
}
