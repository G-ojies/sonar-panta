import { NextRequest, NextResponse } from 'next/server';
import { sweepGuarantee } from '@/lib/desk';
import { payFail } from '../../pay/_err';
export const dynamic = 'force-dynamic';

/** Run the accuracy guarantee: refund paid briefs whose call lost. Authorization: Bearer DESK_SECRET. */
export async function POST(req: NextRequest) {
  const secret = process.env.DESK_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  try { return NextResponse.json(await sweepGuarantee()); } catch (e) { return payFail(e); }
}
