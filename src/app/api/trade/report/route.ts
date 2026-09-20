import { NextResponse } from 'next/server';
import { reportTrade, tradeStatus } from '@/lib/panta';
import { fail } from '../../_util';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  if (typeof b.signature !== 'string') return NextResponse.json({ error: 'BAD_INPUT' }, { status: 400 });
  try { return NextResponse.json(await reportTrade({ signature: b.signature, kind: b.kind === 'claim' ? 'claim' : 'buy', userId: b.wallet ? `sonar:${b.wallet}` : undefined })); }
  catch (e) { return fail(e); }
}
export async function GET(req: Request) {
  const sig = new URL(req.url).searchParams.get('signature');
  if (!sig) return NextResponse.json({ error: 'BAD_INPUT' }, { status: 400 });
  try { return NextResponse.json(await tradeStatus(sig)); } catch (e) { return fail(e); }
}
