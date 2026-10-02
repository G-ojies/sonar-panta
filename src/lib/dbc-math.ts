/**
 * The DBC arithmetic on its own, with no IDL and no decoder, so the browser can share it without the 145 KB IDL.
 * See dbc.ts for the formulas in context.
 */

const TWO_64 = 2 ** 64;

/** Quote per whole base token from a Q64.64 sqrt price: (sqrt / 2^64)^2 * 10^(baseDecimals - quoteDecimals). */
export function priceFromSqrt(sqrtPrice: bigint | string, baseDecimals: number, quoteDecimals: number): number {
  const s = Number(BigInt(sqrtPrice)) / TWO_64;
  return s * s * 10 ** (baseDecimals - quoteDecimals);
}

/** Percent of the way to graduation: quote held over the migration threshold, capped at 100. Null when the threshold is unknown. */
export function progressPct(quoteReserve: bigint | string, threshold: bigint | string): number | null {
  const t = BigInt(threshold || 0);
  if (t <= 0n) return null;
  return Math.min(100, Number((BigInt(quoteReserve || 0) * 10_000n) / t) / 100);
}

export type CurveStatus = 'trading' | 'complete' | 'migrated';

/** Where the curve is: trading, complete (filled, DAMM pool not yet created) or migrated. */
export function curveStatus(pool: { is_migrated: number; finish_curve_timestamp: bigint }): CurveStatus {
  if (pool.is_migrated !== 0) return 'migrated';
  if (pool.finish_curve_timestamp !== 0n) return 'complete';
  return 'trading';
}

/** Lamports (or quote base units) to a display amount. */
export const fromRaw = (raw: bigint | string | number, decimals: number) => Number(raw) / 10 ** decimals;
