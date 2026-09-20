import { NextResponse } from 'next/server';
import { PantaApiError } from '@/lib/panta';

export function fail(e: unknown) {
  if (e instanceof PantaApiError) {
    return NextResponse.json({ error: e.code, message: e.message, fields: e.fields }, { status: e.status });
  }
  const msg = (e as Error)?.message ?? 'unknown error';
  return NextResponse.json({ error: 'INTERNAL', message: msg }, { status: 500 });
}

export const isPubkey = (s: unknown): s is string => typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
