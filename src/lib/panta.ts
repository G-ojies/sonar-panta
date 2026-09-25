/**
 * Server-side Panta API client. Never import from client components —
 * the API key lives only in the server environment.
 */
import type {
  BuyBuild, BuyQuote, CreateBuild, CreateQuote, MarketDetail, MarketRow, PantaError,
  PositionsResponse, Trade,
} from './types';

const BASE = process.env.PANTA_API_BASE_URL ?? 'https://live-api.panta.market/api/v1';

export class PantaApiError extends Error {
  code: string;
  status: number;
  fields?: Record<string, string[]>;
  constructor(status: number, body: PantaError) {
    super(body.message ?? body.code);
    this.code = body.code ?? 'UNKNOWN';
    this.status = status;
    this.fields = body.fields;
  }
}

/** Simple token bucket so one process never trips the 120/60s read limit. */
class Limiter {
  private stamps: number[] = [];
  constructor(private max: number, private windowMs: number) {}
  async take() {
    for (;;) {
      const now = Date.now();
      this.stamps = this.stamps.filter((t) => now - t < this.windowMs);
      if (this.stamps.length < this.max) { this.stamps.push(now); return; }
      const wait = this.windowMs - (now - this.stamps[0]) + 25;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}
const readLimiter = new Limiter(100, 60_000);
const writeLimiter = new Limiter(25, 60_000);

function key(mode: 'live' | 'test' = 'live') {
  const k = mode === 'test' ? process.env.PANTA_TEST_API_KEY : process.env.PANTA_API_KEY;
  if (!k) throw new Error(`Missing ${mode === 'test' ? 'PANTA_TEST_API_KEY' : 'PANTA_API_KEY'}`);
  return k;
}

export interface CallOpts { mode?: 'live' | 'test'; userId?: string; retries?: number }

export async function pantaFetch<T>(path: string, init: RequestInit = {}, opts: CallOpts = {}): Promise<T> {
  const isWrite = (init.method ?? 'GET') !== 'GET';
  await (isWrite ? writeLimiter : readLimiter).take();
  const headers: Record<string, string> = {
    'X-Api-Key': key(opts.mode),
    Accept: 'application/json',
    'User-Agent': 'sonar-panta/0.1 (+https://github.com/G-ojies/sonar-panta)',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.body) headers['Content-Type'] = 'application/json';
  if (opts.userId) headers['X-User-Id'] = opts.userId;
  const url = `${BASE}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, { ...init, headers, cache: 'no-store' });
  if (res.status === 429 && (opts.retries ?? 2) > 0) {
    const ra = Number(res.headers.get('retry-after') ?? '2');
    await new Promise((r) => setTimeout(r, (ra + Math.random()) * 1000));
    return pantaFetch<T>(path, init, { ...opts, retries: (opts.retries ?? 2) - 1 });
  }
  const text = await res.text();
  if (process.env.DEBUG_PANTA) console.log(`[panta] ${init.method ?? 'GET'} ${path} -> ${res.status} ${text.length}B`);
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { code: 'BAD_JSON', message: text.slice(0, 200) }; }
  if (!res.ok) throw new PantaApiError(res.status, (body ?? { code: `HTTP_${res.status}` }) as PantaError);
  return body as T;
}

// ---------- Reads ----------

export interface ListParams { category?: string; status?: string; createdBy?: 'me'; cursor?: string; limit?: number }

export async function listMarkets(p: ListParams = {}, opts?: CallOpts) {
  const q = new URLSearchParams();
  if (p.category) q.set('category', p.category);
  if (p.status) q.set('status', p.status);
  if (p.createdBy) q.set('createdBy', p.createdBy);
  if (p.cursor) q.set('cursor', p.cursor);
  q.set('limit', String(p.limit ?? 50));
  return pantaFetch<{ items: MarketRow[]; nextCursor: string | null }>(`/markets/?${q}`, {}, opts);
}

/**
 * The public catalog's cursor currently loops (every page returns the same rows),
 * so we widen coverage by fanning out over status × category and de-duplicating.
 */
export async function listOpenMarkets(opts?: CallOpts, onError?: (msg: string) => void): Promise<MarketRow[]> {
  // each known category returns a different 50-row slice; unknown categories (weather, gaming, stocks…) and the
  // region filter return nothing, and P2P markets are absent altogether (feedback item 16), so this is the reachable set
  const cats = ['', 'sports', 'crypto', 'politics', 'entertainment', 'finance', 'science', 'world', 'other'];
  const seen = new Map<string, MarketRow>();
  const jobs: Promise<void>[] = [];
  for (const status of ['primary', 'secondary']) {
    for (const category of cats) {
      jobs.push(
        listMarkets({ status, category: category || undefined, limit: 50 }, opts)
          .then((r) => { for (const m of r.items) if (!seen.has(m.marketId)) seen.set(m.marketId, m); })
          .catch((e) => { onError?.(`list ${status}/${category || '*'}: ${(e as Error).message}`); }), // one failed partition must not sink the radar
      );
    }
  }
  await Promise.all(jobs);
  return [...seen.values()];
}

export const getMarket = (id: string, opts?: CallOpts) => pantaFetch<MarketDetail>(`/markets/${id}/`, {}, opts);

export const getMarketTrades = (id: string, limit = 200, opts?: CallOpts) =>
  pantaFetch<{ marketId: string; items: Trade[] }>(`/markets/${id}/trades/?limit=${Math.min(limit, 200)}`, {}, opts);

export const getWalletTrades = (wallet: string, limit = 200, opts?: CallOpts) =>
  pantaFetch<{ wallet: string; items: Trade[] }>(`/wallets/${wallet}/trades/?limit=${Math.min(limit, 200)}`, {}, opts);

export const getPositions = (wallet: string, opts?: CallOpts) =>
  pantaFetch<PositionsResponse>(`/positions/?wallet=${encodeURIComponent(wallet)}`, {}, opts);

export const getCategories = (opts?: CallOpts) => pantaFetch<{ categories: string[] }>('/categories/', {}, opts);

export const getAccount = (opts?: CallOpts) =>
  pantaFetch<{ userId: string; email: string; name: string; status: string; canCreateMarkets: boolean }>('/account/', {}, opts);

export const getMetrics = (opts?: CallOpts) => pantaFetch<Record<string, unknown>>('/account/metrics/', {}, opts);

// ---------- Primary buy: quote → build → submit → verify ----------

export const quoteBuy = (b: { wallet: string; marketId: string; side: 'yes' | 'no'; amountUsdc: string; userId?: string }, opts?: CallOpts) =>
  pantaFetch<BuyQuote>('/primaryorderquote/', { method: 'POST', body: JSON.stringify(b) }, opts);

export const buildBuy = (b: { quoteId: string; wallet: string; maxSlippageBps?: number; userId?: string }, opts?: CallOpts) =>
  pantaFetch<BuyBuild>('/primaryorderbuild/', { method: 'POST', body: JSON.stringify({ maxSlippageBps: 100, ...b }) }, opts);

export const submitBuy = (b: { orderId: string; signature: string }, opts?: CallOpts) =>
  pantaFetch<{ status: string; signature: string; message?: string }>('/primaryordersubmit/', { method: 'POST', body: JSON.stringify(b) }, opts);

export const verifyBuy = (b: { orderId: string; signature?: string }, opts?: CallOpts) =>
  pantaFetch<{ status: string; signature?: string }>('/primaryorderverify/', { method: 'POST', body: JSON.stringify(b) }, opts);

// ---------- Create: quote → build → register ----------

export interface CreateParams {
  wallet: string; question: string; resolutionRule: string; sourcesOfTruth: string[];
  category: string; startTime: number; endTime: number; resolutionTime: number; imageUrl: string;
  marketType?: 'standard' | 'breaking'; eventInProgress?: boolean; title?: string; description?: string; region?: string;
}
export const quoteCreate = (b: CreateParams, opts?: CallOpts) =>
  pantaFetch<CreateQuote>('/markets/create/quote/', { method: 'POST', body: JSON.stringify(b) }, opts);
export const buildCreate = (b: { createId: string; wallet: string }, opts?: CallOpts) =>
  pantaFetch<CreateBuild>('/markets/create/build/', { method: 'POST', body: JSON.stringify(b) }, opts);
export const registerCreate = (b: { createId: string; signature: string }, opts?: CallOpts) =>
  pantaFetch<{ marketId: string; status: string }>('/markets/register/', { method: 'POST', body: JSON.stringify(b) }, opts);

// ---------- Claims + attribution ----------

export const buildClaim = (b: { wallet: string; marketId: string }, opts?: CallOpts) =>
  pantaFetch<{ instructions: BuyBuild['instructions']; recentBlockhash: string; winningShares?: string }>('/claim/build/', { method: 'POST', body: JSON.stringify(b) }, opts);
export const buildCreatorFees = (b: { wallet: string; marketId: string }, opts?: CallOpts) =>
  pantaFetch<{ instructions: BuyBuild['instructions']; recentBlockhash: string }>('/claim/creator-fees/build/', { method: 'POST', body: JSON.stringify(b) }, opts);
export const reportTrade = (b: { signature: string; kind?: 'buy' | 'claim'; userId?: string }, opts?: CallOpts) =>
  pantaFetch<Record<string, unknown>>('/trades/', { method: 'POST', body: JSON.stringify(b) }, opts);
export const tradeStatus = (signature: string, opts?: CallOpts) =>
  pantaFetch<Record<string, unknown>>(`/trades/${signature}/`, {}, opts);

// ---------- Helpers ----------

/** Panta returns prices as "0.43" on some fields and as 1e9-scaled integers on others. */
export function normPrice(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n > 1.0001) return n / 1e9;
  return n;
}

export function marketYesPrice(d: MarketDetail): number | null {
  const oc = d.onChain ?? undefined;
  if (d.phase === 'resolved' || oc?.isResolved) return oc?.yesWins ? 1 : 0;
  return normPrice(d.yesPrice) ?? normPrice(d.secondaryYesPrice) ?? normPrice(d.primaryYesPrice) ?? normPrice(oc?.lastYesPrice);
}

export function isTradable(d: MarketDetail, now = Date.now() / 1000): boolean {
  const oc = d.onChain ?? undefined;
  if (!oc?.isActive) return false;
  if (oc.isGraduated || oc.isResolved || oc.isCancelled) return false;
  const ppe = Number(oc.primaryPhaseEndTime ?? 0);
  if (ppe && ppe < now) return false;
  return Number(d.endTime) > now;
}

export const marketUrl = (id: string) => `https://panta.market/market/${id}`;
