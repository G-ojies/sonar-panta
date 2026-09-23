import { NextResponse } from 'next/server';
import { buildCreate } from '@/lib/panta';
import { fail, isPubkey, modeOf } from '../../_util';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  if (!isPubkey(b.wallet) || typeof b.createId !== 'string') return NextResponse.json({ error: 'BAD_INPUT' }, { status: 400 });
  try { return NextResponse.json(await buildCreate({ createId: b.createId, wallet: b.wallet }, modeOf(b))); } catch (e) { return fail(e); }
}
