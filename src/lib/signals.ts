/**
 * Sonar signal engine — pure functions over a market's detail row, its trade tape,
 * and previous price snapshots. No I/O here so it is trivially testable.
 */
import type { MarketDetail, SignalSet, Snapshot, Trade, VenueMatch } from './types';

const H = 3600;

function n(v: unknown): number { const x = Number(v); return Number.isFinite(x) ? x : 0; }

export function tapeStats(tape: Trade[], now: number) {
  const buys = tape.filter((t) => (t.kind ?? 'buy') === 'buy');
  const recent = buys.filter((t) => t.blockTime && now - t.blockTime < 24 * H);
  const win = recent.length >= 5 ? recent : buys.slice(0, 20);
  let yes = 0, no = 0, total = 0, maxPrint = 0;
  const byWallet = new Map<string, number>();
  for (const t of win) {
    const s = n(t.shares) || (n(t.yesAmount) + n(t.noAmount)) / 1e6;
    total += s; maxPrint = Math.max(maxPrint, s);
    if (t.side === 'yes' || n(t.yesAmount) > 0) yes += s; else no += s;
    byWallet.set(t.wallet, (byWallet.get(t.wallet) ?? 0) + s);
  }
  let hhi = 0;
  for (const v of byWallet.values()) { const p = total ? v / total : 0; hhi += p * p; }
  const last6h = buys.filter((t) => t.blockTime && now - t.blockTime < 6 * H).length;
  const lastTs = buys.reduce((m, t) => Math.max(m, t.blockTime ?? 0), 0);
  return {
    count: win.length, yes, no, total, maxPrint, hhi,
    flow: total ? (yes - no) / total : 0,
    velocity: last6h / 6,
    staleness: lastTs ? now - lastTs : null,
    wallets: byWallet.size,
  };
}

export function momentumFrom(snaps: Snapshot[], current: number | null, now: number): number | null {
  if (current === null) return null;
  // compare against the oldest snapshot inside the last 24h (or the oldest we have)
  const cands = snaps.filter((s) => s.yesPrice !== null && now - s.ts <= 24 * H);
  const ref = (cands.length ? cands : snaps.filter((s) => s.yesPrice !== null)).sort((a, b) => a.ts - b.ts)[0];
  if (!ref || ref.yesPrice === null) return null;
  return current - ref.yesPrice;
}

const clamp = (x: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, x));

export function computeSignals(
  d: MarketDetail, tape: Trade[], snaps: Snapshot[], yesPrice: number | null,
  venue: VenueMatch | null, now = Date.now() / 1000,
): SignalSet {
  const s = tapeStats(tape, now);
  const momentum = momentumFrom(snaps, yesPrice, now);
  const ttc = Number(d.endTime) - now;
  const gap = venue && yesPrice !== null ? venue.yesPrice - yesPrice : null;
  const reasons: string[] = [];

  // --- component scores in [-1, 1], positive favours YES ---
  const flow = clamp(s.flow) * Math.min(1, s.count / 8);
  if (Math.abs(s.flow) > 0.35 && s.count >= 4) reasons.push(`${s.flow > 0 ? 'YES' : 'NO'} flow ${(Math.abs(s.flow) * 100).toFixed(0)}% of last ${s.count} prints`);

  const mom = momentum === null ? 0 : clamp(momentum * 5);
  if (momentum !== null && Math.abs(momentum) >= 0.03) reasons.push(`price ${momentum > 0 ? 'up' : 'down'} ${(Math.abs(momentum) * 100).toFixed(1)}pts vs 24h`);

  const whale = s.total ? s.maxPrint / s.total : 0;
  const whaleDir = (() => {
    const big = tape.filter((t) => n(t.shares) >= s.maxPrint * 0.999)[0];
    return big ? (big.side === 'yes' ? 1 : -1) : 0;
  })();
  const whaleSig = whale > 0.4 && s.count >= 3 ? whaleDir * (whale - 0.4) / 0.6 : 0;
  if (whaleSig) reasons.push(`single ${whaleDir > 0 ? 'YES' : 'NO'} print is ${(whale * 100).toFixed(0)}% of recent volume`);

  // cross-venue: if Polymarket/Kalshi price YES much higher than Panta, YES is cheap here.
  const cv = gap === null ? 0 : clamp(gap * 4);
  if (gap !== null && Math.abs(gap) >= 0.05) reasons.push(`${venue!.venue} prices YES at ${(venue!.yesPrice * 100).toFixed(0)}¢ vs Panta ${((yesPrice ?? 0) * 100).toFixed(0)}¢`);

  // weights: cross-venue is the strongest evidence when present, then flow, momentum, whale
  const raw = (gap !== null ? 0.45 * cv : 0) + (gap !== null ? 0.25 : 0.45) * flow + 0.2 * mom + 0.1 * whaleSig;
  // penalise thin, stale or concentrated tape
  let quality = 1;
  if (s.count < 3) quality *= 0.5;
  if (s.staleness !== null && s.staleness > 3 * 24 * H) quality *= 0.6;
  if (s.hhi > 0.6 && s.wallets < 3) quality *= 0.6;
  if (ttc < 0) quality = 0;
  const score = Math.round(clamp(raw) * 100 * quality);
  const abs = Math.abs(score);
  const side: SignalSet['side'] = abs < 12 ? 'FLAT' : score > 0 ? 'YES' : 'NO';
  const confidence: SignalSet['confidence'] = abs >= 45 && s.count >= 5 ? 'high' : abs >= 20 ? 'medium' : 'low';
  if (s.count === 0) reasons.push('no prints on the tape yet');
  if (s.hhi > 0.6 && s.wallets < 3 && s.count) reasons.push(`tape dominated by ${s.wallets} wallet${s.wallets === 1 ? '' : 's'}`);

  return {
    flowImbalance: s.flow, momentum, whaleShare: whale, concentration: s.hhi, velocity: s.velocity,
    staleness: s.staleness, timeToClose: ttc, crossVenueGap: gap, score, side, confidence, reasons,
  };
}
