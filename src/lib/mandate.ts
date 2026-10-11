/**
 * The shopping agent's mandate: what the person allows it to buy, and the budget it can never cross.
 * The model proposes; these rules decide. Pure, so the limits are tested without a model in the loop.
 */
import { BRIEF_PRICE_CENTS, sellable, type Brief } from './briefs';
import type { RadarMarket } from './types';

export interface Mandate {
  /** total the agent may commit in this session, in cents (pending + paid briefs) */
  maxCents: number;
  /** empty = any category */
  categories: string[];
  /** least |score| a call needs before the agent may buy its brief */
  minScore: number;
  /** skip markets closing sooner than this many hours (no time to act on the brief) */
  minHoursLeft: number;
}

export const DEFAULT_MANDATE: Mandate = { maxCents: 600, categories: [], minScore: 20, minHoursLeft: 6 };
const HARD_CAP_CENTS = 2000;

/** Clamp whatever the browser sent into something safe. */
export function parseMandate(v: unknown): Mandate {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const num = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
  return {
    maxCents: Math.max(0, Math.min(HARD_CAP_CENTS, Math.round(num(o.maxCents, DEFAULT_MANDATE.maxCents)))),
    categories: Array.isArray(o.categories) ? o.categories.filter((c): c is string => typeof c === 'string').map((c) => c.toLowerCase()).slice(0, 8) : [],
    minScore: Math.max(0, Math.min(100, num(o.minScore, DEFAULT_MANDATE.minScore))),
    minHoursLeft: Math.max(0, Math.min(24 * 30, num(o.minHoursLeft, DEFAULT_MANDATE.minHoursLeft))),
  };
}

export interface Candidate { marketId: string; title: string; category: string; side: 'YES' | 'NO'; score: number; confidence: string; yesPrice: number | null; hoursLeft: number; reasons: string[] }

/** Open markets the mandate allows, strongest call first. */
export function candidates(markets: RadarMarket[], m: Mandate, now = Date.now() / 1000, limit = 8): Candidate[] {
  return markets
    .filter((x) => sellable(x, now).ok)
    .filter((x) => !m.categories.length || m.categories.includes((x.detail.category ?? '').toLowerCase()))
    .filter((x) => Math.abs(x.signals.score) >= m.minScore)
    .filter((x) => (Number(x.detail.endTime) - now) / 3600 >= m.minHoursLeft)
    .sort((a, b) => Math.abs(b.signals.score) - Math.abs(a.signals.score))
    .slice(0, limit)
    .map((x) => ({
      marketId: x.detail.marketId, title: x.detail.title || x.detail.question || x.detail.marketId, category: x.detail.category,
      side: x.signals.side === 'NO' ? 'NO' : 'YES', score: x.signals.score, confidence: x.signals.confidence, yesPrice: x.yesPrice,
      hoursLeft: Math.round((Number(x.detail.endTime) - now) / 3600), reasons: x.signals.reasons.slice(0, 3),
    }));
}

/** Committed spend: every agent brief in the session that is not refunded counts against the budget. */
export const committed = (briefs: Brief[]) => briefs.filter((b) => b.status !== 'refunded').reduce((a, b) => a + b.priceCents, 0);

export type BuyCheck = { ok: true } | { ok: false; reason: string };

/** The gate in front of every purchase the agent asks for. */
export function mayBuy(market: RadarMarket | null, m: Mandate, sessionBriefs: Brief[], now = Date.now() / 1000): BuyCheck {
  if (!market) return { ok: false, reason: 'unknown market' };
  const allowed = candidates([market], m, now, 1);
  if (!allowed.length) return { ok: false, reason: 'outside the mandate (category, call strength, time left, or no live call)' };
  if (sessionBriefs.some((b) => b.marketId === market.detail.marketId && b.status !== 'refunded')) return { ok: false, reason: 'already bought this brief in this session' };
  const left = m.maxCents - committed(sessionBriefs);
  if (left < BRIEF_PRICE_CENTS) return { ok: false, reason: `budget left $${(left / 100).toFixed(2)} is below the $${(BRIEF_PRICE_CENTS / 100).toFixed(2)} brief price` };
  return { ok: true };
}
