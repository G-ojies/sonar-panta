/**
 * Sonar Desk briefs: what a brief costs, what call it locks in, and the accuracy guarantee.
 * A brief freezes Sonar's call (side, score, price) at the moment of purchase. When the market settles against
 * that call, or is cancelled, the buyer gets the money back through PayPal. Pure: the store and PayPal calls
 * live in the routes and the agent tick.
 */
import type { MarketDetail, RadarMarket } from './types';

export const BRIEF_PRICE_CENTS = 199;

/** 'missed' is a wrong call on a Sonar Pro brief: the subscription paid for it, so there is no single payment to refund. */
export type BriefStatus = 'pending' | 'paid' | 'refunded' | 'kept' | 'missed';
export interface Brief {
  id: string;
  marketId: string;
  title: string;
  /** the call the buyer paid for, frozen at order time */
  call: { side: 'YES' | 'NO'; score: number; confidence: 'high' | 'medium' | 'low'; yesPrice: number | null; reasons: string[] };
  priceCents: number;
  orderId: string;
  captureId?: string;
  payer?: string;
  createdAt: number;
  paidAt?: number;
  status: BriefStatus;
  /** set once the market settles */
  outcome?: 'YES' | 'NO' | 'CANCELLED';
  refundId?: string;
  settledAt?: number;
  /** 'agent' when the shopping agent created the order; a person still approves it */
  via: 'button' | 'agent' | 'pro';
  /** Sonar Pro subscription that covered it (priceCents 0, no capture) */
  subscriptionId?: string;
  /** the shopping-agent session that created it, for the session budget */
  session?: string;
}

/** Sonar only sells a brief when it has a side; a FLAT market has nothing to guarantee. */
export function sellable(m: RadarMarket | null | undefined, now = Date.now() / 1000): { ok: true } | { ok: false; reason: string } {
  if (!m) return { ok: false, reason: 'unknown market' };
  if (m.detail.resolved || m.detail.phase === 'resolved' || m.detail.phase === 'cancelled') return { ok: false, reason: 'market already settled' };
  if (Number(m.detail.endTime) <= now) return { ok: false, reason: 'market closed' };
  if (m.signals.side === 'FLAT') return { ok: false, reason: 'Sonar has no call on this market yet' };
  return { ok: true };
}

export function freezeCall(m: RadarMarket): Brief['call'] {
  const side = m.signals.side === 'NO' ? 'NO' : 'YES';
  return { side, score: m.signals.score, confidence: m.signals.confidence, yesPrice: m.yesPrice, reasons: m.signals.reasons.slice(0, 6) };
}

/** Settled outcome of a market, or null while it is still open. Same rule as the walk-forward record. */
export function outcomeOf(d: MarketDetail): Brief['outcome'] | null {
  if (d.phase === 'cancelled' || d.onChain?.isCancelled) return 'CANCELLED';
  if (!d.onChain?.isResolved && d.phase !== 'resolved' && !d.resolved) return null;
  if (d.onChain?.yesWins) return 'YES';
  const yes = Number(d.yesPrice ?? d.onChain?.lastYesPrice);
  return yes === 1 ? 'YES' : 'NO';
}

export type GuaranteeAction = { kind: 'refund'; brief: Brief; note: string } | { kind: 'keep'; brief: Brief } | { kind: 'miss'; brief: Brief } | { kind: 'wait'; brief: Brief };

/** What the guarantee does with one paid brief, given the market's current detail. */
export function guarantee(b: Brief, d: MarketDetail | null): GuaranteeAction {
  const pro = b.via === 'pro' && !!b.subscriptionId;
  if (b.status !== 'paid' || (!b.captureId && !pro) || !d) return { kind: 'wait', brief: b };
  const o = outcomeOf(d);
  if (!o) return { kind: 'wait', brief: b };
  if (pro) return o === b.call.side ? { kind: 'keep', brief: { ...b, outcome: o } } : { kind: 'miss', brief: { ...b, outcome: o } };
  if (o === 'CANCELLED') return { kind: 'refund', brief: { ...b, outcome: o }, note: `Sonar Desk: "${b.title.slice(0, 120)}" was cancelled, so your brief is refunded.` };
  if (o !== b.call.side) return { kind: 'refund', brief: { ...b, outcome: o }, note: `Sonar Desk called ${b.call.side} on "${b.title.slice(0, 120)}" and it resolved ${o}. Wrong call, full refund.` };
  return { kind: 'keep', brief: { ...b, outcome: o } };
}

/** The guarantee's public record: how many paid briefs were right, and how much went back to buyers. */
export function ledgerStats(briefs: Brief[]) {
  const settled = briefs.filter((b) => b.status === 'refunded' || b.status === 'kept' || b.status === 'missed');
  const refunded = settled.filter((b) => b.status === 'refunded');
  const kept = settled.filter((b) => b.status === 'kept');
  const sum = (xs: Brief[]) => xs.reduce((a, b) => a + b.priceCents, 0);
  return {
    sold: briefs.filter((b) => b.status !== 'pending').length,
    open: briefs.filter((b) => b.status === 'paid').length,
    right: kept.length,
    refunded: refunded.length,
    missed: settled.filter((b) => b.status === 'missed').length,
    refundedCents: sum(refunded),
    keptCents: sum(kept),
    hitRate: settled.length ? kept.length / settled.length : null,
  };
}
