/**
 * Chain endpoints: where Sonar reads Solana from. With SOLAMI_API_KEY set, Solami (https://solami.dev) is the
 * data path: its private RPC answers the tape rebuild and its WebSocket carries the live program log. With no
 * key everything falls back to SOLANA_RPC / NEXT_PUBLIC_SOLANA_RPC or the public mainnet endpoint, as before.
 * The two paths degrade on their own: a key on the Free plan has RPC (5 requests a second) but no WebSocket,
 * so the rebuild runs on Solami while the stream stays on the fallback endpoint.
 *
 * URL formats and auth are from Solami's public docs (Endpoints, RPC, WebSocket; read 30 Sep 2026):
 *   RPC        https://rpc.solami.dev/sol?api_key=KEY     region-pinned: https://fra.rpc.solami.dev/sol
 *   WebSocket  wss://ws.solami.dev/ws/sol?api_key=KEY     region-pinned: wss://fra.ws.solami.dev/ws/sol
 * The key goes in the query string on both. If the dashboard shows a different URL for a key, paste it whole
 * into SOLAMI_RPC_URL / SOLAMI_WS_URL and it is used as given.
 */
export type ProviderName = 'solami' | 'custom' | 'public';
export interface Endpoint { provider: ProviderName; url: string }
export interface ChainEndpoints { http: Endpoint; ws: Endpoint; /** Used when Solami refuses the key; null when Solami is not configured. */ fallback: { http: Endpoint; ws: Endpoint } | null }
type Env = Record<string, string | undefined>;
type Kind = 'http' | 'ws';

export const PUBLIC_RPC = 'https://api.mainnet-beta.solana.com';
const SOLAMI_REGIONS = ['ams', 'fra', 'nyc'];

const clean = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);
const toWs = (http: string) => http.replace(/^http/, 'ws');
/** Appends the key, unless the URL already carries one (a URL copied whole from the dashboard). */
const withKey = (url: string, key: string | undefined) => (!key || /[?&]api_key=/.test(url) ? url : `${url}${url.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(key)}`);
const keyIn = (url: string | undefined) => { try { return url ? new URL(url).searchParams.get('api_key') ?? undefined : undefined; } catch { return undefined; } };

export function chainEndpoints(env: Env = process.env): ChainEndpoints {
  const http = clean(env.SOLANA_RPC) ?? clean(env.NEXT_PUBLIC_SOLANA_RPC) ?? PUBLIC_RPC;
  const provider: ProviderName = http === PUBLIC_RPC ? 'public' : 'custom';
  const plain = { http: { provider, url: http }, ws: { provider, url: clean(env.SOLANA_WS) ?? toWs(http) } };
  const rpcUrl = clean(env.SOLAMI_RPC_URL), wsUrl = clean(env.SOLAMI_WS_URL);
  const key = clean(env.SOLAMI_API_KEY) ?? keyIn(rpcUrl);
  if (!key && !rpcUrl) return { ...plain, fallback: null };
  const region = clean(env.SOLAMI_REGION)?.toLowerCase();
  const pin = region && SOLAMI_REGIONS.includes(region) ? `${region}.` : ''; // anything else: global, nearest point of presence
  return {
    http: { provider: 'solami', url: withKey(rpcUrl ?? `https://${pin}rpc.solami.dev/sol`, key) },
    // with neither a key nor a socket URL there is nothing to open a Solami socket with
    ws: key || wsUrl ? { provider: 'solami', url: withKey(wsUrl ?? `wss://${pin}ws.solami.dev/ws/sol`, key) } : plain.ws,
    fallback: plain,
  };
}

/** Host only, for health output and logs: the key lives in the query string and must never be printed. */
export function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return 'invalid-url'; }
}

/**
 * A refusal is an answer that will not change on retry: the key is unknown or revoked (401), the balance is
 * empty (402), the key type or allowlist is wrong (403), or the plan has no WebSocket access (400 on the
 * upgrade). Solami is then left alone for a while and the fallback endpoint carries the traffic.
 */
const REFUSAL_HOLD_MS = 30 * 60_000;
const refusedUntil: Record<Kind, number> = { http: 0, ws: 0 };
export const isRefusal = (kind: Kind, status: number) => status === 401 || status === 402 || status === 403 || (kind === 'ws' && status === 400);
export function markRefused(kind: Kind, now = Date.now()) { refusedUntil[kind] = now + REFUSAL_HOLD_MS; }
export function clearRefused() { refusedUntil.http = 0; refusedUntil.ws = 0; }

/** The endpoint to use right now: Solami when configured and not recently refused, the fallback otherwise. */
export function pickEndpoint(kind: Kind, ep: ChainEndpoints = chainEndpoints(), now = Date.now()): Endpoint {
  return ep.fallback && now < refusedUntil[kind] ? ep.fallback[kind] : ep[kind];
}

/** Spaces calls so no more than `rps` start in any second. Each call returns how long that caller should wait. */
export function spacer(rps: number) {
  let next = 0;
  return (now = Date.now()) => { const at = Math.max(now, next); next = at + 1000 / rps; return at - now; };
}

let gate: (() => number) | null = null;
/** Milliseconds to wait before the next Solami RPC call. The Free plan allows 5 requests a second; SOLAMI_RPS (default 4) sets the pace. */
export function solamiWait(): number {
  gate ??= spacer(Math.max(1, Number(process.env.SOLAMI_RPS) || 4));
  return gate();
}
