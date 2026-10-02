import { NextRequest, NextResponse } from 'next/server';
import { readAgent, runAgent, summarize } from '@/lib/agent';
import { readBacktest, runBacktest } from '@/lib/backtest';
import { curveTick } from '@/lib/curve';
import { store } from '@/lib/store';
import { fail } from '../_util';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Vercel's request context, when running there: lets the function outlive the response. Off Vercel it is absent and the promise simply runs on in this process. */
function waitUntil(p: Promise<unknown>) {
  const ctx = (globalThis as unknown as Record<symbol, { get?: () => { waitUntil?: (p: Promise<unknown>) => void } } | undefined>)[Symbol.for('@vercel/request-context')];
  ctx?.get?.()?.waitUntil?.(p);
}

/** Held while a tick runs so a pinger that fires again early, or a GitHub run landing at the same time, does not start a second one. */
const LOCK = 'sonar:tick-lock';
const LOCK_TTL = 240;
/** Least time between two scans. A little under twenty minutes, so the second of two 10-minute pings always runs. */
const MIN_TICK_S = Number(process.env.SONAR_MIN_TICK_SECONDS ?? 1080);

export async function GET() {
  const [st, bt] = await Promise.all([readAgent(), readBacktest()]);
  return NextResponse.json({ agent: st, summary: summarize(st), backtest: bt ? { ...bt, rows: bt.rows.slice(0, 40) } : null }, { headers: { 'Cache-Control': 'no-store' } });
}

/**
 * One tick: refresh the radar, settle and open paper positions, re-run the backtest every sixth run, then refresh the curve index.
 * Authorization: Bearer CRON_SECRET or ?key=. Answers 202 at once and finishes in the background, so
 * any pinger with a short timeout can drive it; ?wait=1 blocks until the tick is done, ?force=1 runs one
 * even if the last was recent.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}` && req.nextUrl.searchParams.get('key') !== secret) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const s = store();
  try {
    const held = await s.get<number>(LOCK);
    if (held) return NextResponse.json({ ok: true, started: false, reason: 'tick in progress', since: held }, { status: 202 });
    const prev = await readAgent();
    // The pinger calls every 10 minutes, which also keeps the host awake. A scan runs on every second call:
    // Panta's markets move slowly, and the host's monthly data allowance is shared with everything else.
    const since = Date.now() / 1000 - (prev?.lastRunAt ?? 0);
    if (since < MIN_TICK_S && req.nextUrl.searchParams.get('force') !== '1') return NextResponse.json({ ok: true, started: false, reason: 'last tick was recent', secondsAgo: Math.round(since) }, { status: 202 });
    await s.set(LOCK, Date.now() / 1000, LOCK_TTL);
    const work = (async () => {
      try {
        const st = await runAgent();
        if (st.runs % 6 === 1) await runBacktest();
        await curveTick(); // the Meteora DBC index rides the same tick (src/lib/curve.ts)
      } catch (e) { console.error('tick failed', (e as Error).message); }
      finally { await s.del(LOCK).catch(() => {}); }
    })();
    if (req.nextUrl.searchParams.get('wait') === '1') {
      await work;
      const st = await readAgent();
      return NextResponse.json({ ok: true, started: true, runs: st?.runs ?? 0, summary: summarize(st) });
    }
    waitUntil(work);
    return NextResponse.json({ ok: true, started: true, runs: prev?.runs ?? 0 }, { status: 202 });
  } catch (e) { await s.del(LOCK).catch(() => {}); return fail(e); }
}
