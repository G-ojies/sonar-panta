import { NextResponse } from 'next/server';
import { draftMarket } from '@/lib/draft';
import { fail } from '../../_util';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const input = String(b.input ?? '').trim();
  if (input.length < 8 || input.length > 4000) return NextResponse.json({ error: 'BAD_INPUT', message: 'Give a headline, question or URL.' }, { status: 400 });
  try { return NextResponse.json(await draftMarket(input)); } catch (e) { return fail(e); }
}
