import { NextResponse } from 'next/server';
import { registerCreate } from '@/lib/panta';
import { fail, modeOf } from '../../_util';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  if (typeof b.createId !== 'string' || typeof b.signature !== 'string') return NextResponse.json({ error: 'BAD_INPUT' }, { status: 400 });
  try { return NextResponse.json(await registerCreate({ createId: b.createId, signature: b.signature }, modeOf(b))); } catch (e) { return fail(e); }
}
