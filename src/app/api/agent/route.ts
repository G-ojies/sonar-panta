import { NextRequest, NextResponse } from 'next/server';
import { readAgent, runAgent, summarize } from '@/lib/agent';
import { readBacktest } from '@/lib/backtest';
import { fail } from '../_util';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET() {
  const [st, bt] = await Promise.all([readAgent(), readBacktest()]);
  return NextResponse.json({ agent: st, summary: summarize(st), backtest: bt ? { ...bt, rows: bt.rows.slice(0, 40) } : null }, { headers: { 'Cache-Control': 'no-store' } });
}
/** Cron / manual tick. Authorization: Bearer CRON_SECRET or ?key= */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}` && req.nextUrl.searchParams.get('key') !== secret) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  try { const st = await runAgent(); return NextResponse.json({ ok: true, runs: st.runs, summary: summarize(st) }); } catch (e) { return fail(e); }
}
