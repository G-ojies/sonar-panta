import { NextResponse } from 'next/server';
import { quoteCreate, type CreateParams } from '@/lib/panta';
import { fail, isPubkey } from '../../_util';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Partial<CreateParams>;
  if (!isPubkey(b.wallet) || !b.question || !b.resolutionRule || !b.sourcesOfTruth?.length || !b.category || !b.imageUrl) return NextResponse.json({ error: 'BAD_INPUT' }, { status: 400 });
  try { return NextResponse.json(await quoteCreate(b as CreateParams)); } catch (e) { return fail(e); }
}
