/**
 * Radar: builds the ranked, signal-annotated view of every open Panta market.
 * refreshRadar() is the heavy path (≈2 API calls per market) and is meant to run
 * from a cron / the agent loop; readRadar() serves cached output to requests.
 */
import { appendPrints, fetchChainTape, mergeTapes, tapeIsShort, type ChainTapeCache } from './chain-tape';
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
  chain: (id: string) => `sonar:chaintape:${id}`,
  log: 'sonar:refresh-log',
  resolved: 'sonar:resolved-ids',
  known: 'sonar:known-ids',
  strikes: 'sonar:stripped-strikes',
};
/** Scans in a row a market may answer stripped with nothing cached before the registry lets it go. */
const STRIKES_LIMIT = 6;
/** Seconds before an open market is priced against the other venues again. */
const VENUE_RECHECK_S = 3 * 3600;
/** Markets whose tape is rebuilt from chain in one scan. Each costs one signature list plus one getTransaction per print. */
const CHAIN_TAPES_PER_SCAN = Number(process.env.CHAIN_TAPES_PER_SCAN ?? 3);
export const CHAIN_TAPE_KEY = K.chain;
/** Every market id a scan has seen and still tracks. The live stream maps a print to its market with it. */
export const KNOWN_IDS_KEY = K.known;
/** Ids of every resolved market a scan has passed. The catalog rotates, so the backtest replays from this. */
export const RESOLVED_IDS_KEY = K.resolved;

export interface RadarOutput {
  updatedAt: number;
  scanned: number;
  markets: RadarMarket[];
  /** API failures: rate limits, 5xx, network. */
  errors: string[];
  /** Markets Panta answered for with a stripped row and nothing cached. Not failures: retried next scan. */
  skipped: string[];
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

/**
 * A resolved market whose tape is complete never changes again, so its row is carried over from the previous
 * scan instead of being fetched, read and scored again. Most of the radar is history, and this is what keeps a
 * scan to a few dozen requests.
 */
export function isSettled(prev: RadarMarket | undefined): prev is RadarMarket {
  return !!prev && prev.settled === true && prev.detail.phase === 'resolved';
}

/** A snapshot is worth keeping when something moved, or once an hour so the chart has a point to draw. */
export function shouldSnapshot(last: Snapshot | undefined, now: number, yesPrice: number | null, volumeUsdc: number, trades: number): boolean {
  if (!last) return true;
  if (now - last.ts < 600) return false;
  return last.yesPrice !== yesPrice || last.volumeUsdc !== volumeUsdc || last.trades !== trades || now - last.ts >= 3600;
}

export async function refreshRadar(opts: { venues?: boolean; maxMarkets?: number } = {}): Promise<RadarOutput> {
  const t0 = Date.now();
  const now = Date.now() / 1000;
  const errors: string[] = [];
  const skipped: string[] = [];
  const s = store();

  const lastScan = (await s.get<RadarOutput>(K.radar))?.markets ?? [];
  const settled = new Map(lastScan.filter(isSettled).map((m) => [m.detail.marketId, m]));

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
    await s.lpush(K.log, { ts: now, scanned: 0, kept: prev?.markets.length ?? 0, errors: errors.length, skipped: 0, durationMs: Date.now() - t0, note: 'empty scan, kept previous radar' }, 100);
    if (prev) return { ...prev, errors: [...errors, 'empty scan: served previous radar'], skipped: prev.skipped ?? [] };
  }

  const hasContent = (d: MarketDetail | null | undefined): d is MarketDetail => !!d && !!(d.title || d.question || d.onChain?.question || d.onChain);
  // A market that answers stripped with nothing cached, scan after scan, is one Panta no longer
  // serves (deleted or never published). Count strikes so the registry can let it go instead of
  // reporting the same fourteen ids as "API errors" forever.
  const strikes = (await s.get<Record<string, number>>(K.strikes)) ?? {};
  const fetched = await mapLimit(ids, 4, async (id) => {
    try {
      const kept = settled.get(id);
      if (kept) return kept.detail;
      const cached = await s.get<MarketDetail>(K.detail(id));
      if (cached && cached.phase === 'resolved' && hasContent(cached)) return cached; // resolved rows never change
      let d = await getMarket(id);
      // Panta's detail endpoint intermittently answers with a stripped row (blank title, no onChain
      // state, phase reset to "secondary"). Retry once, then fall back to the cached row; never let a
      // stripped answer overwrite a good row or drop the market.
      if (!hasContent(d)) { await new Promise((r) => setTimeout(r, 400)); d = await getMarket(id); }
      if (!hasContent(d)) {
        if (hasContent(cached)) return cached;
        strikes[id] = (strikes[id] ?? 0) + 1;
        skipped.push(`detail ${id}: stripped row from Panta, no cached copy (strike ${strikes[id]}/${STRIKES_LIMIT})`);
        return null;
      }
      delete strikes[id];
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
  // remember every id we have ever seen; a *good* row that fails shouldTrack (cancelled, long
  // resolved) drops out, and so does an id that has answered stripped STRIKES_LIMIT scans running.
  // Failed fetches and fresher stripped ones stay so the next scan retries them.
  const drop = new Set(ids.filter((_, i) => fetched[i] && !shouldTrack(fetched[i] as MarketDetail, now)));
  for (const [id, n] of Object.entries(strikes)) if (n >= STRIKES_LIMIT) { drop.add(id); delete strikes[id]; }
  await s.set(K.strikes, strikes);
  await s.set(K.known, [...new Set([...knownIds, ...ids])].filter((id) => !drop.has(id)).slice(-2000));

  // Open markets first so a live market gets its chain tape before the resolved history does.
  details.sort((a, b) => Number(b.phase !== 'resolved') - Number(a.phase !== 'resolved'));
  let chainBudget = CHAIN_TAPES_PER_SCAN;
  const markets = await mapLimit(details, 4, async (d): Promise<RadarMarket | null> => {
    try {
      const id = d.marketId;
      const kept = settled.get(id);
      if (kept) return kept;
      let tape: Trade[] = [];
      let complete = false;
      try { tape = (await getMarketTrades(id, 200)).items; await s.set(K.tape(id), tape, 3600); }
      catch (e) { tape = (await s.get<Trade[]>(K.tape(id))) ?? []; errors.push(`tape ${id}: ${(e as Error).message}`); }
      // The trades endpoint is empty for most resolved markets and every graduated one, and short for others
      // (feedback item 17). The program logs every primary order, so rebuild the tape from chain when the API
      // returned fewer prints than the chain counts; resolved tapes never change, so they are fetched once.
      if (tapeIsShort(tape, d.onChain?.totalTrades)) {
        let chain = await s.get<ChainTapeCache>(K.chain(id));
        // a resolved or graduated market takes no more primary orders: fetch its tape once. (The chain counter also
        // includes the creator's seed at creation, which is not a print, so the merged tape can stay one short.)
        const frozen = d.phase === 'resolved' || !!d.onChain?.isGraduated;
        const stale = !chain || (!frozen && now - chain.ts > 3600) || (!chain.complete && now - chain.ts > 86400);
        if (stale && chainBudget > 0) {
          chainBudget--;
          try {
            const began = Date.now() / 1000;
            chain = await fetchChainTape(id, { concurrency: Number(process.env.CHAIN_TAPE_CONCURRENCY ?? 1), expected: Number(d.onChain?.totalTrades ?? 0) });
            // an open market can print while its tape is being rebuilt: keep what the live stream stored in that window
            // (and only that, so the rebuild stays the source of truth for everything older)
            if (!frozen) chain = appendPrints(chain, ((await s.get<ChainTapeCache>(K.chain(id)))?.trades ?? []).filter((t) => (t.blockTime ?? 0) > began - 120));
            await s.set(K.chain(id), chain, frozen ? 90 * 86400 : 7 * 86400);
          }
          // the endpoint throttled or failed; the tape is retried next scan and the API tape stands meanwhile
          catch (e) { skipped.push(`chain tape ${id}: ${(e as Error).message}, retried next scan`); }
        }
        if (chain) tape = mergeTapes(tape, chain.trades);
        complete = frozen && !!chain?.complete;
      } else complete = true;
      const yesPrice = marketYesPrice(d);
      const snaps = (await s.get<Snapshot[]>(K.snaps(id))) ?? [];
      const question = d.title || d.question || d.onChain?.question || '';
      let venue: VenueMatch | null = (await s.get<VenueMatch>(K.venue(id))) ?? null;
      if (opts.venues !== false && question && d.phase !== 'resolved' && (!venue || (now - (await s.get<number>(`${K.venue(id)}:ts`) ?? 0)) > VENUE_RECHECK_S)) {
        try { venue = await matchVenues(question); await s.set(K.venue(id), venue ?? { none: true }, 6 * 3600); await s.set(`${K.venue(id)}:ts`, now); }
        catch (e) { errors.push(`venue ${id}: ${(e as Error).message}`); }
      }
      if (venue && (venue as unknown as { none?: boolean }).none) venue = null;
      const signals = computeSignals(d, tape, snaps, yesPrice, venue, now);
      // append a snapshot when something moved (keep 14 days); a resolved market has stopped moving
      const volumeUsdc = Number(d.totalVolumeUsdc ?? d.volumeUsdc ?? 0);
      if (d.phase !== 'resolved' && shouldSnapshot(snaps[snaps.length - 1], now, yesPrice, volumeUsdc, tape.length)) {
        snaps.push({ marketId: id, ts: now, yesPrice, volumeUsdc, trades: tape.length });
        await s.set(K.snaps(id), snaps.filter((x) => now - x.ts < 14 * 86400));
      }
      return { detail: d, yesPrice, tape: tape.slice(0, 50), signals, venue, tradable: isTradable(d, now), updatedAt: now, ...(d.phase === 'resolved' && complete ? { settled: true } : {}) };
    } catch (e) { errors.push(`market ${d.marketId}: ${(e as Error).message}`); return null; }
  });

  const out: RadarOutput = {
    updatedAt: now, scanned: ids.length, errors, skipped,
    markets: markets.filter((m): m is RadarMarket => !!m).sort(rank),
    durationMs: Date.now() - t0,
  };
  await s.set(K.radar, out);
  radarCache = { at: Date.now(), value: out };
  logCache = null;
  await s.lpush(K.log, { ts: now, scanned: out.scanned, kept: out.markets.length, errors: errors.length, skipped: skipped.length, durationMs: out.durationMs }, 100);
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

// The radar is the largest value in the store and every page, the health check and the chart poll read it.
// One copy is kept in this process for a minute, so those reads do not each fetch it again.
const READ_TTL_MS = 60_000;
let radarCache: { at: number; value: RadarOutput | null } | null = null;
let logCache: { at: number; value: RefreshLogRow[] } | null = null;
type RefreshLogRow = { ts: number; scanned: number; kept: number; errors: number; skipped?: number; durationMs: number };

export async function readRadar(): Promise<RadarOutput | null> {
  if (radarCache && Date.now() - radarCache.at < READ_TTL_MS) return radarCache.value;
  const value = await store().get<RadarOutput>(K.radar);
  radarCache = { at: Date.now(), value };
  return value;
}

export async function readMarket(id: string): Promise<RadarMarket | null> {
  const r = await readRadar();
  return r?.markets.find((m) => m.detail.marketId === id) ?? null;
}

/** The chain-decoded tape cached for a market, if a scan has rebuilt one. */
export async function readChainTape(id: string): Promise<ChainTapeCache | null> {
  return store().get<ChainTapeCache>(K.chain(id));
}

export async function readSnapshots(id: string): Promise<Snapshot[]> {
  return (await store().get<Snapshot[]>(K.snaps(id))) ?? [];
}

export async function readRefreshLog(): Promise<RefreshLogRow[]> {
  if (logCache && Date.now() - logCache.at < READ_TTL_MS) return logCache.value;
  const value = await store().lrange<RefreshLogRow>(K.log, 0, 20);
  logCache = { at: Date.now(), value };
  return value;
}
