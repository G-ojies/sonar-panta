import { NextResponse } from 'next/server';
import { ledgerStats } from '@/lib/briefs';
import { listBriefs, sweepIfDue } from '@/lib/desk';
import { payFail } from '../../pay/_err';
export const dynamic = 'force-dynamic';

/** The guarantee's public record: every settled brief, right or refunded. No payer details. */
export async function GET() {
  try {
    // settle resolved markets first, so the record people see is current
    await sweepIfDue().catch(() => null);
    const briefs = await listBriefs();
    const settled = briefs.filter((b) => b.status === 'kept' || b.status === 'refunded').slice(0, 50)
      .map((b) => ({ id: b.id, marketId: b.marketId, title: b.title, side: b.call.side, outcome: b.outcome, status: b.status, priceCents: b.priceCents, settledAt: b.settledAt, via: b.via }));
    return NextResponse.json({ stats: ledgerStats(briefs), settled }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return payFail(e); }
}
