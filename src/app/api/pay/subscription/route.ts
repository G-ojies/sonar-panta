import { NextRequest, NextResponse } from 'next/server';
import { proStatus } from '@/lib/desk';
import { payFail } from '../_err';
export const dynamic = 'force-dynamic';

/** GET ?id=<subscription id>[&fresh=1]: whether this Sonar Pro subscription is active. */
export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id');
    if (!id || !/^I-[A-Z0-9]{6,30}$/.test(id)) return NextResponse.json({ error: 'BAD_REQUEST', message: 'subscription id required' }, { status: 400 });
    return NextResponse.json(await proStatus(id, undefined, req.nextUrl.searchParams.get('fresh') === '1'), { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return payFail(e); }
}
