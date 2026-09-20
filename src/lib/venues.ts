/**
 * Cross-venue matching: find the same question on Polymarket (and best-effort Kalshi)
 * so Sonar can price Panta markets against the wider prediction-market tape.
 */
import type { VenueMatch } from './types';

const STOP = new Set('will the a an of in on by to be at for and or is are before after above below than more less this that with from as it its into over under up down out yes no'.split(' '));

export function tokens(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9$#@.]+/g) ?? [])
    .map((t) => t.replace(/^[$#@]/, '').replace(/[.]+$/, ''))
    .filter((t) => t.length > 1 && !STOP.has(t));
}

export function similarity(a: string, b: string): number {
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const t of A) if (B.has(t)) inter++;
  // Dice on tokens, with a bonus if numbers match (thresholds, dates)
  const dice = (2 * inter) / (A.size + B.size);
  const numsA = [...A].filter((t) => /\d/.test(t)), numsB = [...B].filter((t) => /\d/.test(t));
  const numHit = numsA.length && numsB.length ? numsA.filter((x) => numsB.includes(x)).length / Math.max(numsA.length, numsB.length) : 0.5;
  return Math.min(1, dice * 0.8 + numHit * 0.2);
}

interface GammaMarket {
  id: string; question: string; slug: string; outcomes?: string; outcomePrices?: string;
  volume24hr?: number; endDate?: string; closed?: boolean; active?: boolean; lastTradePrice?: number; bestBid?: number; bestAsk?: number;
}
interface GammaEvent { slug: string; title: string; markets?: GammaMarket[] }

async function getJson<T>(url: string, ms = 12_000): Promise<T | null> {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch { return null; } finally { clearTimeout(t); }
}

function gammaYes(m: GammaMarket): number | null {
  try {
    const outs = JSON.parse(m.outcomes ?? '[]') as string[];
    const prices = JSON.parse(m.outcomePrices ?? '[]') as string[];
    const i = outs.findIndex((o) => o.toLowerCase() === 'yes');
    const p = Number(prices[i >= 0 ? i : 0]);
    return Number.isFinite(p) ? p : null;
  } catch { return null; }
}

/** Query Polymarket's public Gamma search with the market's most specific tokens. */
export async function matchPolymarket(question: string, minSim = 0.42): Promise<VenueMatch | null> {
  const toks = tokens(question);
  if (!toks.length) return null;
  // prefer proper nouns / numbers; cap query length
  const q = toks.filter((t) => /\d/.test(t) || t.length > 3).slice(0, 6).join(' ') || toks.slice(0, 5).join(' ');
  const data = await getJson<{ events?: GammaEvent[] }>(`https://gamma-api.polymarket.com/public-search?q=${encodeURIComponent(q)}&limit_per_type=8`);
  const events = data?.events ?? [];
  let best: VenueMatch | null = null;
  for (const ev of events) {
    for (const m of ev.markets ?? []) {
      if (m.closed) continue;
      const yes = gammaYes(m);
      if (yes === null) continue;
      const sim = Math.max(similarity(question, m.question), similarity(question, `${ev.title} ${m.question}`) * 0.95);
      if (sim < minSim) continue;
      if (!best || sim > best.similarity) {
        best = {
          venue: 'polymarket', id: m.id, question: m.question,
          url: `https://polymarket.com/event/${ev.slug}`, yesPrice: yes,
          volume24h: m.volume24hr ?? null, endDate: m.endDate ?? null, similarity: sim,
        };
      }
    }
  }
  return best;
}

interface KalshiMarket { ticker: string; event_ticker: string; title: string; yes_sub_title?: string; yes_bid?: number | null; yes_ask?: number | null; last_price?: number | null; volume_24h?: number | null; close_time?: string; status: string }

let kalshiCache: { ts: number; markets: KalshiMarket[] } | null = null;
/** Kalshi has no free-text search on the public API; pull a page of open markets and match locally. */
export async function matchKalshi(question: string, minSim = 0.5): Promise<VenueMatch | null> {
  if (!kalshiCache || Date.now() - kalshiCache.ts > 10 * 60_000) {
    const pages: KalshiMarket[] = [];
    let cursor = '';
    for (let i = 0; i < 4; i++) {
      const d = await getJson<{ markets: KalshiMarket[]; cursor?: string }>(`https://api.elections.kalshi.com/trade-api/v2/markets?limit=1000&status=open${cursor ? `&cursor=${cursor}` : ''}`);
      if (!d) break;
      pages.push(...d.markets);
      if (!d.cursor) break;
      cursor = d.cursor;
    }
    kalshiCache = { ts: Date.now(), markets: pages };
  }
  let best: VenueMatch | null = null;
  for (const m of kalshiCache.markets) {
    const text = `${m.title} ${m.yes_sub_title ?? ''}`;
    if (text.length > 200) continue; // combo/parlay tickers
    const sim = similarity(question, text);
    if (sim < minSim) continue;
    const px = m.last_price ?? (m.yes_bid && m.yes_ask ? (m.yes_bid + m.yes_ask) / 2 : null);
    if (px === null || px === undefined) continue;
    if (!best || sim > best.similarity) {
      best = { venue: 'kalshi', id: m.ticker, question: m.title, url: `https://kalshi.com/markets/${m.event_ticker.toLowerCase()}`, yesPrice: px / 100, volume24h: m.volume_24h ?? null, endDate: m.close_time ?? null, similarity: sim };
    }
  }
  return best;
}

export async function matchVenues(question: string): Promise<VenueMatch | null> {
  const [pm, ks] = await Promise.all([matchPolymarket(question), matchKalshi(question).catch(() => null)]);
  if (pm && ks) return pm.similarity >= ks.similarity ? pm : ks;
  return pm ?? ks;
}
