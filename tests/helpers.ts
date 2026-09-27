import type { MarketDetail, Trade } from '../src/lib/types';

export const T0 = 1_790_000_000;

let seq = 0;
/** A primary buy print. `at` is seconds after T0. */
export function print(side: 'yes' | 'no', shares: number, at: number, extra: Partial<Trade> = {}): Trade {
  seq += 1;
  return {
    id: `t${seq}`, marketId: 'mkt', wallet: `w${seq}`, isPrimary: true, kind: 'buy', side,
    shares: shares.toFixed(6), yesAmount: side === 'yes' ? shares * 1e6 : 0, noAmount: side === 'no' ? shares * 1e6 : 0,
    feePaid: 0, amountUsdc: null, blockTime: T0 + at, signature: `sig${seq}`, quoteAsset: 'USDC', ...extra,
  } as Trade;
}

/** A market that closes `closesIn` seconds after T0. */
export function market(closesIn = 7 * 86400, extra: Partial<MarketDetail> = {}): MarketDetail {
  return { marketId: 'mkt', phase: 'primary', endTime: T0 + closesIn, primaryYesPrice: 0.5, ...extra } as unknown as MarketDetail;
}
