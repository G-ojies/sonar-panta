/**
 * The arithmetic of a graduation market, mirroring the program (onchain/programs/curve_market/src/lib.rs) so the
 * page can show odds, payouts and whether `resolve` would go through, without the IDL or web3.js in its bundle.
 */
export type Side = 'yes' | 'no';
export type MarketState = 'open' | 'yes' | 'no' | 'refund';

/** Smallest stake the program accepts, in base units: 0.001 SOL or 1 USDC. */
export const MIN_STAKE = 1_000_000n;
export const MAX_DEADLINE_SECS = 180 * 86400;

/** `payout_for` from the program: floored pro-rata share computed in u128, zero for a zero stake. */
export function payoutFor(winningStake: bigint, winningTotal: bigint, totalPool: bigint): bigint {
  if (winningStake === 0n) return 0n;
  if (winningTotal === 0n) throw new Error('curve-market: zero winning total');
  return (winningStake * totalPool) / winningTotal;
}

export interface Totals { yesTotalRaw: string; noTotalRaw: string }
export interface Stakes { yesAmountRaw: string; noAmountRaw: string }

/** What a position receives on each outcome at the totals as they stand, and what it receives now if the market is resolved. */
export function positionPayout(m: Totals & { state: MarketState }, p: Stakes): { ifYes: bigint; ifNo: bigint; refund: bigint; now: bigint | null } {
  const yes = BigInt(m.yesTotalRaw), no = BigInt(m.noTotalRaw), pool = yes + no;
  const py = BigInt(p.yesAmountRaw), pn = BigInt(p.noAmountRaw);
  const ifYes = yes > 0n ? payoutFor(py, yes, pool) : 0n;
  const ifNo = no > 0n ? payoutFor(pn, no, pool) : 0n;
  const refund = py + pn;
  const now = m.state === 'yes' ? ifYes : m.state === 'no' ? ifNo : m.state === 'refund' ? refund : null;
  return { ifYes, ifNo, refund, now };
}

/** Implied odds from the parimutuel totals: each side's share of the pool. null when nothing is staked. */
export function impliedOdds(m: Totals): { yes: number; no: number } | null {
  const yes = Number(m.yesTotalRaw), no = Number(m.noTotalRaw);
  if (yes + no <= 0) return null;
  return { yes: yes / (yes + no), no: no / (yes + no) };
}

/** The multiple a winning stake on `side` pays at today's totals, stake included; null when the side is empty. */
export function sideMultiple(m: Totals, side: Side): number | null {
  const yes = Number(m.yesTotalRaw), no = Number(m.noTotalRaw);
  const mine = side === 'yes' ? yes : no;
  if (mine <= 0) return null;
  return (yes + no) / mine;
}

export interface PoolSnapshot { finishCurveAt: number | null; status: 'trading' | 'complete' | 'migrated'; quoteReserveRaw: string; thresholdRaw: string }

/** The program's `decide`: the side `resolve` would settle on from a pool snapshot, or null while the question is open. */
export function decide(pool: PoolSnapshot, deadlineTs: number, now: number): Side | null {
  if (pool.finishCurveAt) return pool.finishCurveAt <= deadlineTs ? 'yes' : 'no';
  if (pool.status === 'migrated') return 'yes';
  if (BigInt(pool.quoteReserveRaw || '0') >= BigInt(pool.thresholdRaw || '0') && now <= deadlineTs) return 'yes';
  if (now > deadlineTs) return 'no';
  return null;
}

/** The state `resolve` writes: a refund when either side is empty, else the decided side. */
export function resolvedState(m: Totals, verdict: Side): MarketState {
  return BigInt(m.yesTotalRaw) === 0n || BigInt(m.noTotalRaw) === 0n ? 'refund' : verdict;
}
