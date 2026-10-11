import { NextRequest, NextResponse } from 'next/server';
import { startPro } from '@/lib/desk';
import { payFail } from '../_err';
export const dynamic = 'force-dynamic';

/** POST -> a Sonar Pro subscription waiting for approval in PayPal. */
export async function POST(req: NextRequest) {
  try {
    const origin = process.env.DESK_BASE_URL ?? req.nextUrl.origin;
    return NextResponse.json(await startPro(`${origin}/desk/pro`));
  } catch (e) { return payFail(e); }
}
