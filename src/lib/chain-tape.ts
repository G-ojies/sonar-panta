/**
 * Chain tape: the prints Panta's trades endpoint does not return, read from the program's own log.
 *
 * Every primary order the Panta program executes writes one plain-text line to the transaction log:
 *   "Primary Order (USDC): side=No, amount=1727203, yes_price=499344245, no_price=500655755, minted=3440032"
 *   "Primary Order: side=Yes, lamports=245272000, yes_price=549137856, no_price=450862144, minted=439326839"
 * so a market's full tape, with the exact YES price after each print, can be rebuilt from
 * getSignaturesForAddress(market) + getTransaction(sig) with no IDL. GET /markets/{id}/trades/ is empty
 * for most resolved markets and for every graduated one (feedback item 17); this fills the gap.
 */
import type { Trade } from './types';

const RPC = () => process.env.SOLANA_RPC ?? process.env.NEXT_PUBLIC_SOLANA_RPC ?? 'https://api.mainnet-beta.solana.com';
const ORDER = /Primary Order(?: \((\w+)\))?: side=(Yes|No), (?:lamports|amount)=(\d+), yes_price=(\d+), no_price=(\d+), minted=(\d+)/;

export interface ChainTapeCache { ts: number; trades: Trade[]; signatures: number; complete: boolean }

interface SigInfo { signature: string; blockTime: number | null; err: unknown }
interface Tx { blockTime: number | null; meta: { err: unknown; logMessages?: string[] } | null; transaction: { message: { accountKeys: (string | { pubkey: string })[] } } }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function rpc<T>(method: string, params: unknown[], tries = 5): Promise<T> {
  for (let i = 0; ; i++) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 30_000);
    try {
      const res = await fetch(RPC(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: ctl.signal, cache: 'no-store' });
      if (res.status === 429 || res.status >= 500) throw new Error(`rpc ${res.status}`);
      const j = (await res.json()) as { result?: T; error?: { message: string } };
      if (j.error) throw new Error(j.error.message);
      return j.result as T;
    } catch (e) {
      if (i >= tries - 1) throw e;
      await sleep(1500 * 2 ** i + Math.random() * 500); // public RPC: back off on 429 and hiccups
    } finally { clearTimeout(t); }
  }
}

/** One parsed order line, or null when the line is something else. */
export function parseOrderLog(line: string): { quote: 'USDC' | 'SOL'; side: 'yes' | 'no'; amountRaw: number; yesPrice: number; shares: number } | null {
  const m = ORDER.exec(line);
  if (!m) return null;
  return { quote: m[1] === 'USDC' ? 'USDC' : 'SOL', side: m[2] === 'Yes' ? 'yes' : 'no', amountRaw: Number(m[3]), yesPrice: Number(m[4]) / 1e9, shares: Number(m[6]) / 1e6 };
}

/** Prints inside one confirmed transaction (a transaction can carry more than one order; rare). */
export function tradesFromTx(marketId: string, signature: string, tx: Tx): Trade[] {
  if (!tx.meta || tx.meta.err || !tx.meta.logMessages) return [];
  const k0 = tx.transaction.message.accountKeys[0];
  const wallet = typeof k0 === 'string' ? k0 : k0?.pubkey ?? '';
  const out: Trade[] = [];
  for (const line of tx.meta.logMessages) {
    const o = parseOrderLog(line);
    if (!o) continue;
    const raw = o.amountRaw;
    out.push({
      id: out.length ? `${signature}:${out.length}` : signature, marketId, wallet, isPrimary: true, kind: 'buy', side: o.side,
      shares: o.shares.toFixed(6), yesAmount: o.side === 'yes' ? raw : 0, noAmount: o.side === 'no' ? raw : 0, feePaid: 0,
      amountUsdc: o.quote === 'USDC' ? (raw / 1e6).toFixed(6) : null, blockTime: tx.blockTime, signature, quoteAsset: o.quote,
      price: o.yesPrice, source: 'chain',
    });
  }
  return out;
}

/**
 * Rebuild a market's primary tape from chain. `maxSignatures` bounds the work on a public RPC; a market
 * with more history than that comes back marked incomplete (newest prints first, like the API).
 */
export async function fetchChainTape(marketId: string, opts: { maxSignatures?: number; concurrency?: number } = {}): Promise<ChainTapeCache> {
  const max = opts.maxSignatures ?? 300;
  const sigs: SigInfo[] = [];
  let before: string | undefined;
  for (;;) {
    const page = await rpc<SigInfo[]>('getSignaturesForAddress', [marketId, { limit: Math.min(1000, max - sigs.length), ...(before ? { before } : {}) }]);
    sigs.push(...page);
    if (page.length < 1000 || sigs.length >= max) break;
    before = page[page.length - 1].signature;
  }
  const ok = sigs.filter((s) => !s.err);
  const trades: Trade[] = [];
  let i = 0;
  await Promise.all(Array.from({ length: opts.concurrency ?? 2 }, async () => {
    for (;;) {
      const idx = i++; if (idx >= ok.length) return;
      const s = ok[idx];
      const tx = await rpc<Tx | null>('getTransaction', [s.signature, { encoding: 'json', maxSupportedTransactionVersion: 0 }]);
      if (tx) trades.push(...tradesFromTx(marketId, s.signature, tx));
    }
  }));
  trades.sort((a, b) => (b.blockTime ?? 0) - (a.blockTime ?? 0));
  return { ts: Date.now() / 1000, trades, signatures: sigs.length, complete: sigs.length < max };
}

/** Union of the API tape and the chain tape by signature, newest first. API rows win on a clash (they carry the API ids). */
export function mergeTapes(api: Trade[], chain: Trade[]): Trade[] {
  const seen = new Set(api.map((t) => t.signature));
  const out = [...api.map((t) => ({ ...t, source: t.source ?? ('api' as const) })), ...chain.filter((t) => !seen.has(t.signature))];
  return out.sort((a, b) => (b.blockTime ?? 0) - (a.blockTime ?? 0));
}

/** True when the API returned fewer prints than the chain says the market has. (`totalTrades` counts the creator's seed too, so this stays true for a complete chain tape as well; the radar's staleness rule decides whether to fetch again.) */
export function tapeIsShort(apiTape: Trade[], totalTrades: unknown): boolean {
  const n = Number(totalTrades ?? 0);
  return Number.isFinite(n) && n > apiTape.filter((t) => (t.kind ?? 'buy') === 'buy').length;
}
