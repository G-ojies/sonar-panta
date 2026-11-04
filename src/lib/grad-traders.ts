/**
 * Who has traded the pm-AMM graduation markets: every swap and claim that touched one of our pm-AMM markets on devnet,
 * read from chain, grouped by the wallet that signed it. Our own wallets (the keeper and the local test wallet) are
 * left out, so the counts are outside traders only. Pure parsing lives here; the RPC reads are in grad-traders-server.ts.
 */
import bs58 from 'bs58';
import { DIRECTION, DISC, MUSDC, PM_AMM_PROGRAM, type Direction } from './grad-market';

/** Wallets run by the Sonar team; their trades are not traction. */
export const TEAM_WALLETS = new Set([
  '9gjTFjRFxoQtzt3z5xb6YFMMnc9yBEJ5HGuPB1Lknqsn', // keeper
  'FHj8w7MuuqMBeEKdFT2BXEEx9Xj6dZ18Z9cLiBmPr513', // local test wallet
]);

export interface TradeEvent {
  sig: string;
  wallet: string;
  binding: string;
  kind: Direction | 'claim';
  /** mUSDC that moved in or out of the wallet, base units, always >= 0. */
  volumeRaw: string;
  blockTime: number;
}

type Ix = { programId: string; data?: string };
type TokenBal = { mint: string; owner?: string; uiTokenAmount: { amount: string } };
/** The parts of a jsonParsed getTransaction result this reads. */
export interface ParsedTx {
  blockTime?: number | null;
  meta: { err: unknown; preTokenBalances?: TokenBal[]; postTokenBalances?: TokenBal[] } | null;
  transaction: { signatures: string[]; message: { accountKeys: ({ pubkey: string; signer?: boolean } | string)[]; instructions: Ix[] } };
}

const eq8 = (a: Uint8Array, b: Uint8Array) => a.length >= 8 && b.every((x, i) => a[i] === x);
const KIND_BY_BYTE = Object.fromEntries(Object.entries(DIRECTION).map(([k, v]) => [v, k as Direction]));

/** The pm-AMM swap or claim in a transaction, if any, as a trade by the fee payer. */
export function tradeFromTx(tx: ParsedTx, binding: string): TradeEvent | null {
  if (!tx.meta || tx.meta.err) return null;
  const keys = tx.transaction.message.accountKeys;
  const first = keys[0];
  const wallet = typeof first === 'string' ? first : first?.pubkey;
  if (!wallet) return null;
  let kind: TradeEvent['kind'] | null = null;
  for (const ix of tx.transaction.message.instructions) {
    if (ix.programId !== PM_AMM_PROGRAM || !ix.data) continue;
    let d: Uint8Array;
    try { d = bs58.decode(ix.data); } catch { continue; }
    if (eq8(d, DISC.swap) && d.length > 8) kind = KIND_BY_BYTE[d[8]] ?? null;
    else if (eq8(d, DISC.claimWinnings)) kind = 'claim';
    if (kind) break;
  }
  if (!kind) return null;
  const bal = (list?: TokenBal[]) => BigInt(list?.find((b) => b.mint === MUSDC && b.owner === wallet)?.uiTokenAmount.amount ?? '0');
  const delta = bal(tx.meta.postTokenBalances) - bal(tx.meta.preTokenBalances);
  return { sig: tx.transaction.signatures[0], wallet, binding, kind, volumeRaw: (delta < 0n ? -delta : delta).toString(), blockTime: tx.blockTime ?? 0 };
}

export interface TraderRow { wallet: string; trades: number; claims: number; volumeRaw: string; markets: number; firstAt: number }
export interface TradersSummary { traders: number; trades: number; volumeRaw: string; rows: TraderRow[] }

/** Leaderboard: outside wallets ranked by trades, then volume, then who came first. */
export function summarize(events: TradeEvent[], limit = 50): TradersSummary {
  const by = new Map<string, { trades: number; claims: number; vol: bigint; markets: Set<string>; firstAt: number }>();
  let trades = 0, vol = 0n;
  for (const e of events) {
    if (TEAM_WALLETS.has(e.wallet)) continue;
    const r = by.get(e.wallet) ?? { trades: 0, claims: 0, vol: 0n, markets: new Set<string>(), firstAt: e.blockTime || Infinity };
    if (e.kind === 'claim') r.claims++;
    else { r.trades++; trades++; r.vol += BigInt(e.volumeRaw); vol += BigInt(e.volumeRaw); }
    r.markets.add(e.binding);
    if (e.blockTime && e.blockTime < r.firstAt) r.firstAt = e.blockTime;
    by.set(e.wallet, r);
  }
  const rows = [...by.entries()]
    .map(([wallet, r]) => ({ wallet, trades: r.trades, claims: r.claims, volumeRaw: r.vol.toString(), markets: r.markets.size, firstAt: Number.isFinite(r.firstAt) ? r.firstAt : 0 }))
    .sort((a, b) => b.trades - a.trades || (BigInt(b.volumeRaw) > BigInt(a.volumeRaw) ? 1 : BigInt(b.volumeRaw) < BigInt(a.volumeRaw) ? -1 : 0) || (a.firstAt || Infinity) - (b.firstAt || Infinity));
  return { traders: rows.length, trades, volumeRaw: vol.toString(), rows: rows.slice(0, limit) };
}
