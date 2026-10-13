import { NextResponse } from 'next/server';
import { ledgerStats, type Brief } from '@/lib/briefs';
import { listBriefs, sweepIfDue } from '@/lib/desk';
import { payFail } from '../../pay/_err';
export const dynamic = 'force-dynamic';

/** The guarantee's public record: every settled brief, right or refunded. No payer details. */
export async function GET() {
  try {
    // settle resolved markets first, so the record people see is current
    await sweepIfDue().catch(() => null);
    const briefs = await listBriefs();
    const row = (b: Brief) => ({ id: b.id, marketId: b.marketId, title: b.title, side: b.call.side, outcome: b.outcome, status: b.status, priceCents: b.priceCents, settledAt: b.settledAt, via: b.via });
    const done = briefs.filter((b) => b.status === 'kept' || b.status === 'refunded');
    // demo settlements (simulated outcome, real sandbox refund) are listed apart and never counted in the stats
    const settled = done.filter((b) => !b.demo).slice(0, 50).map(row);
    const demos = done.filter((b) => b.demo).slice(0, 10).map(row);
    return NextResponse.json({ stats: ledgerStats(briefs), settled, demos }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return payFail(e); }
}
