/**
 * Radar: builds the ranked, signal-annotated view of every open Panta market.
 * refreshRadar() is the heavy path (≈2 API calls per market) and is meant to run
 * from a cron / the agent loop; readRadar() serves cached output to requests.
 */
import { getMarket, getMarketTrades, isTradable, listOpenMarkets, marketYesPrice } from './panta';
import { computeSignals } from './signals';
import { store } from './store';
import { matchVenues } from './venues';
import type { MarketDetail, RadarMarket, Snapshot, Trade, VenueMatch } from './types';

const K = {
  radar: 'sonar:radar:v1',
  snaps: (id: string) => `sonar:snaps:${id}`,
  venue: (id: string) => `sonar:venue:${id}`,
  detail: (id: string) => `sonar:detail:${id}`,
  tape: (id: string) => `sonar:tape:${id}`,
  log: 'sonar:refresh-log',
  resolved: 'sonar:resolved-ids',
  known: 'sonar:known-ids',
};
/** Ids of every resolved market a scan has passed. The catalog rotates, so the backtest replays from this. */
export const RESOLVED_IDS_KEY = K.resolved;

export interface RadarOutput {
  updatedAt: number;
  scanned: number;
  markets: RadarMarket[];
  errors: string[];
  durationMs: number;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) { const idx = i++; if (idx >= items.length) return; out[idx] = await fn(items[idx]); }
  }));
  return out;
}

function shouldTrack(d: MarketDetail, now: number): boolean {
  if (d.phase === 'cancelled') return false;
  if (!(d.title || d.question || d.onChain?.question)) return false; // stale devnet-era rows have no text
  // keep four months of resolved history: it feeds the backtest and gives the radar a record to show
  if (d.phase === 'resolved') return (d.onChain?.resolvedAt ?? Number(d.endTime)) > now - 120 * 86400;
  // Catalog phases go stale: keep anything the chain still calls active, or that ended < 7d ago
  if (d.onChain?.isActive) return true;
  return Number(d.endTime) > now - 7 * 86400;
}

export async function refreshRadar(opts: { venues?: boolean; maxMarkets?: number } = {}): Promise<RadarOutput> {
  const t0 = Date.now();
  const now = Date.now() / 1000;
  const errors: string[] = [];
  const s = store();

  const rows = await listOpenMarkets(undefined, (m) => errors.push(m));
  // The catalog's 50-row pages rotate between scans, so a market listed once can vanish from the
  // next listing while still being live. Track the union of what we see now and what we have seen.
  const knownIds = (await s.get<string[]>(K.known)) ?? [];
  const idSet = new Set<string>(rows.map((r) => r.marketId));
  const listed = idSet.size;
  for (const id of knownIds) idSet.add(id);
  const ids = [...idSet].slice(0, opts.maxMarkets ?? 400);
  if (listed === 0) errors.push('listing returned nothing: refreshing from the known-id registry only');
  if (ids.length === 0) {
    // Never replace a good radar with an empty one (transient API failure).
    const prev = await s.get<RadarOutput>(K.radar);
    await s.lpush(K.log, { ts: now, scanned: 0, kept: prev?.markets.length ?? 0, errors: errors.length, durationMs: Date.now() - t0, note: 'empty scan, kept previous radar' }, 100);
    if (prev) return { ...prev, errors: [...errors, 'empty scan: served previous radar'] };
  }

  const hasContent = (d: MarketDetail | null | undefined): d is MarketDetail => !!d && !!(d.title || d.question || d.onChain?.question || d.onChain);
  const fetched = await mapLimit(ids, 4, async (id) => {
    try {
      const cached = await s.get<MarketDetail>(K.detail(id));
      if (cached && cached.phase === 'resolved' && hasContent(cached)) return cached; // resolved rows never change
      const d = await getMarket(id);
      // Panta's detail endpoint intermittently answers with a stripped row (blank title, no onChain
      // state, phase reset to "secondary"). Never let that overwrite a good row or drop the market.
      if (!hasContent(d)) {
        if (hasContent(cached)) return cached;
        errors.push(`detail ${id}: stripped row from Panta, no cached copy`);
        return null;
      }
      // resolved rows never change: keep them for a month so a stripped answer later has a good copy to fall back on
      await s.set(K.detail(id), d, d.phase === 'resolved' ? 30 * 86400 : 6 * 3600);
      return d;
    } catch (e) { errors.push(`detail ${id}: ${(e as Error).message}`); return null; }
  });
  const known = new Set((await s.get<string[]>(K.resolved)) ?? []);
  const before = known.size;
  for (const d of fetched) if (d?.phase === 'resolved') known.add(d.marketId);
  if (known.size !== before) await s.set(K.resolved, [...known].slice(-1000));
  const details = fetched.filter((d): d is MarketDetail => !!d && shouldTrack(d, now));
  // remember every id we have ever seen; only a *good* row that fails shouldTrack (cancelled,
  // long resolved) drops out. Failed or stripped fetches stay so the next scan retries them.
  const drop = new Set(ids.filter((_, i) => fetched[i] && !shouldTrack(fetched[i] as MarketDetail, now)));
  await s.set(K.known, [...new Set([...knownIds, ...ids])].filter((id) => !drop.has(id)).slice(-2000));

  const markets = await mapLimit(details, 4, async (d): Promise<RadarMarket | null> => {
    try {
      const id = d.marketId;
      let tape: Trade[] = [];
      try { tape = (await getMarketTrades(id, 200)).items; await s.set(K.tape(id), tape, 3600); }
      catch (e) { tape = (await s.get<Trade[]>(K.tape(id))) ?? []; errors.push(`tape ${id}: ${(e as Error).message}`); }
      const yesPrice = marketYesPrice(d);
      const snaps = (await s.get<Snapshot[]>(K.snaps(id))) ?? [];
      const question = d.title || d.question || d.onChain?.question || '';
      let venue: VenueMatch | null = (await s.get<VenueMatch>(K.venue(id))) ?? null;
      if (opts.venues !== false && question && d.phase !== 'resolved' && (!venue || (now - (await s.get<number>(`${K.venue(id)}:ts`) ?? 0)) > 1800)) {
        try { venue = await matchVenues(question); await s.set(K.venue(id), venue ?? { none: true }, 6 * 3600); await s.set(`${K.venue(id)}:ts`, now); }
        catch (e) { errors.push(`venue ${id}: ${(e as Error).message}`); }
      }
      if (venue && (venue as unknown as { none?: boolean }).none) venue = null;
      const signals = computeSignals(d, tape, snaps, yesPrice, venue, now);
      // append a snapshot (keep 14 days, at most one per 10 minutes)
      const last = snaps[snaps.length - 1];
      if (!last || now - last.ts > 600) {
        snaps.push({ marketId: id, ts: now, yesPrice, volumeUsdc: Number(d.totalVolumeUsdc ?? d.volumeUsdc ?? 0), trades: tape.length });
        await s.set(K.snaps(id), snaps.filter((x) => now - x.ts < 14 * 86400));
      }
      return { detail: d, yesPrice, tape: tape.slice(0, 50), signals, venue, tradable: isTradable(d, now), updatedAt: now };
    } catch (e) { errors.push(`market ${d.marketId}: ${(e as Error).message}`); return null; }
  });

  const out: RadarOutput = {
    updatedAt: now, scanned: ids.length, errors,
    markets: markets.filter((m): m is RadarMarket => !!m).sort(rank),
    durationMs: Date.now() - t0,
  };
  await s.set(K.radar, out);
  await s.lpush(K.log, { ts: now, scanned: out.scanned, kept: out.markets.length, errors: errors.length, durationMs: out.durationMs }, 100);
  return out;
}

/** Live and tradable first, then by |score|, then by time-to-close. */
export function rank(a: RadarMarket, b: RadarMarket): number {
  const live = (m: RadarMarket) => (m.tradable ? 2 : m.detail.onChain?.isActive ? 1 : 0);
  if (live(a) !== live(b)) return live(b) - live(a);
  const sa = Math.abs(a.signals.score), sb = Math.abs(b.signals.score);
  if (sa !== sb) return sb - sa;
  return a.signals.timeToClose - b.signals.timeToClose;
}

export async function readRadar(): Promise<RadarOutput | null> {
  return store().get<RadarOutput>(K.radar);
}

export async function readMarket(id: string): Promise<RadarMarket | null> {
  const r = await readRadar();
  return r?.markets.find((m) => m.detail.marketId === id) ?? null;
}

export async function readSnapshots(id: string): Promise<Snapshot[]> {
  return (await store().get<Snapshot[]>(K.snaps(id))) ?? [];
}

export async function readRefreshLog() {
  return store().lrange<{ ts: number; scanned: number; kept: number; errors: number; durationMs: number }>(K.log, 0, 20);
}
