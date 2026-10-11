import { NextResponse } from 'next/server';
import { PayPalError } from '@/lib/paypal';
import { fail } from '../_util';

export function payFail(e: unknown) {
  if (e instanceof PayPalError) return NextResponse.json({ error: e.issue, message: e.message, debugId: e.debugId }, { status: e.status >= 400 && e.status < 600 ? e.status : 502 });
  return fail(e);
}
