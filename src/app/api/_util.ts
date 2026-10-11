import { NextResponse } from 'next/server';
import { PantaApiError } from '@/lib/panta';

export function fail(e: unknown) {
  if (e instanceof PantaApiError) {
    return NextResponse.json({ error: e.code, message: e.message, fields: e.fields }, { status: e.status });
  }
  const msg = (e as Error)?.message ?? 'unknown error';
  return NextResponse.json({ error: 'INTERNAL', message: msg }, { status: 500 });
}

/** Sandbox requests go to Panta's pk_test_ fixtures: nothing on chain, no funds needed. */
export const modeOf = (b: { sandbox?: unknown } | null | undefined): { mode: 'live' | 'test' } => ({ mode: b?.sandbox === true || b?.sandbox === '1' ? 'test' : 'live' });

export const isPubkey = (s: unknown): s is string => typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);

/**
 * A second deployment that shares the database (Sonar Desk, the GitLab Guard service) must never scan or tick:
 * two writers to the same Upstash keys caused the 6 Oct outage. SONAR_READ_ONLY=1 turns the writer routes off.
 * Leaving CRON_SECRET unset does NOT do this: without it those routes accept anyone.
 */
export const readOnly = () => (process.env.SONAR_READ_ONLY === '1' ? NextResponse.json({ error: 'READ_ONLY', message: 'this deployment does not scan or tick' }, { status: 403 }) : null);
