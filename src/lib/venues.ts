/**
 * Cross-venue matching: find the same question on Polymarket (and best-effort Kalshi)
 * so Sonar can price Panta markets against the wider prediction-market tape.
 */
import type { VenueMatch } from './types';

const STOP = new Set('will the a an of in on by to be at for and or is are before after above below than more less this that with from as it its into over under up down out yes no'.split(' '));

/** Light stemming so "release" / "released" / "releases" and "prices" / "price" compare equal. */
export function stem(t: string): string {
  if (t.length > 4 && /[a-z]$/.test(t)) return t.replace(/(ies)$/, 'y').replace(/(ing|ed|es|s)$/, '');
  return t;
}
export function tokens(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9$#@.]+/g) ?? [])
    .map((t) => stem(t.replace(/^[$#@]/, '').replace(/[.,]+$/, '')))
    .filter((t) => t.length > 1 && !STOP.has(t));
}

/** Words that appear in almost every market question and therefore say nothing about *which* question it is. */
const GENERIC = new Set(('january february march april may june july august september october november december jan feb mar apr jun jul aug sep sept oct nov dec ' +
  'release released announce announced launch launched win wins won lose close closes closed above below over under reach reaches hit hits trade trades price priced ' +
  'market cap next new first last end day days week weeks month months year years any point between higher lower than top bottom complete deploy deployed ' +
  'score scores goal goals match game games season official officially confirm confirmed report reported happen happens least most within during time date ' +
  'today tomorrow tonight morning afternoon evening night minute minutes hour hours 2026 2027 2025 pm am utc et pt est').split(' ').map((w) => stem(w)));
const isOrdinalOrTime = (t: string) => /^\d+(st|nd|rd|th)$/.test(t) || /^\d{1,2}(am|pm)$/.test(t);
/** Tokens that identify the subject of a question: names, tickers, specific numbers. */
export function entityTokens(s: string): string[] {
  const raw = s.match(/[A-Za-z0-9$#@.]+/g) ?? [];
  const out = new Set<string>();
  for (const r of raw) {
    const t = stem(r.toLowerCase().replace(/^[$#@]/, '').replace(/[.,]+$/, ''));
    if (t.length < 2 || STOP.has(t) || GENERIC.has(t) || isOrdinalOrTime(t)) continue;
    // short all-caps tokens are tickers / acronyms (GTA, BTC, CZ, NBA); other 2-3 letter words are noise
    if (t.length <= 3 && !/\d/.test(t) && r !== r.toUpperCase()) continue;
    out.add(t);
  }
  return [...out];
}

export function similarity(a: string, b: string): number {
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const t of A) if (B.has(t)) inter++;
  // Dice on tokens, with a bonus if numbers match (thresholds, dates)
  const dice = (2 * inter) / (A.size + B.size);
  const numsA = [...A].filter((t) => /\d/.test(t)), numsB = [...B].filter((t) => /\d/.test(t));
  const numHit = numsA.length && numsB.length ? numsA.filter((x) => numsB.includes(x)).length / Math.max(numsA.length, numsB.length) : 0.5;
  const base = Math.min(1, dice * 0.8 + numHit * 0.2);
  // Two questions about different subjects can share "release", "November" and "2026". Require the subject to overlap.
  const EA = entityTokens(a), EB = new Set(entityTokens(b));
  const shared = EA.filter((t) => EB.has(t)).length;
  if (EA.length && !shared) return 0;
  const subject = EA.length ? shared / Math.min(EA.length, 3) : 1;
  return Math.min(1, base * (0.6 + 0.4 * Math.min(1, subject)));
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
export async function matchPolymarket(question: string, minSim = 0.55): Promise<VenueMatch | null> {
  const toks = tokens(question);
  if (!toks.length) return null;
  // search on the subject (names, tickers, specific numbers) first, then longer words; cap query length
  const ents = entityTokens(question);
  const q = [...ents, ...toks.filter((t) => !ents.includes(t) && (/\d/.test(t) || t.length > 3))].slice(0, 6).join(' ') || toks.slice(0, 5).join(' ');
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
export async function matchKalshi(question: string, minSim = 0.58): Promise<VenueMatch | null> {
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
