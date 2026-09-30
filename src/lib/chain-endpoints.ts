/**
 * Chain endpoints: where Sonar reads Solana from. Two providers are supported, one at a time, in front of a
 * fallback that is always there:
 *
 *   RPC Fast   with RPCFAST_API_KEY set. One host answers JSON-RPC over HTTPS and subscriptions over WebSocket
 *              (https://solana-rpc.rpcfast.com and wss://solana-rpc.rpcfast.com, Frankfurt, mainnet only). Every plan
 *              including the free Start plan carries WebSocket subscriptions, so both paths run on RPC Fast.
 *   Solami     with SOLAMI_API_KEY set. Its RPC answers the tape rebuild and its WebSocket carries the live program
 *              log. A key on the Free plan has RPC (5 requests a second) but no WebSocket, so the rebuild runs on
 *              Solami while the stream stays on the fallback endpoint.
 *
 * With both keys set, RPC Fast is used; CHAIN_PROVIDER=solami|rpcfast picks explicitly. With no key everything runs on
 * SOLANA_RPC / NEXT_PUBLIC_SOLANA_RPC or the public mainnet endpoint, as before, and that endpoint is also the
 * fallback when the provider refuses a call.
 *
 * URL formats and auth, from each provider's docs and dashboard (read 30 Sep 2026):
 *   RPC Fast   https://solana-rpc.rpcfast.com/?api_key=KEY     wss://solana-rpc.rpcfast.com/?api_key=KEY
 *   Solami     https://rpc.solami.dev/sol?api_key=KEY           wss://ws.solami.dev/ws/sol?api_key=KEY
 *              region-pinned: https://fra.rpc.solami.dev/sol    wss://fra.ws.solami.dev/ws/sol
 * The key goes in the query string on both. If a dashboard shows a different URL for a key, paste it whole into
 * RPCFAST_RPC_URL / RPCFAST_WS_URL (or SOLAMI_RPC_URL / SOLAMI_WS_URL) and it is used as given.
 */
export type ProviderName = 'rpcfast' | 'solami' | 'custom' | 'public';
export interface Endpoint { provider: ProviderName; url: string }
export interface ChainEndpoints { http: Endpoint; ws: Endpoint; /** Used when the provider refuses the key; null when no provider is configured. */ fallback: { http: Endpoint; ws: Endpoint } | null }
type Env = Record<string, string | undefined>;
type Kind = 'http' | 'ws';
type Pair = { http: Endpoint; ws: Endpoint };

export const PUBLIC_RPC = 'https://api.mainnet-beta.solana.com';
export const RPCFAST_RPC = 'https://solana-rpc.rpcfast.com/';
export const RPCFAST_WS = 'wss://solana-rpc.rpcfast.com/';
const SOLAMI_REGIONS = ['ams', 'fra', 'nyc'];

/** Display names, for health output, logs and the market page. */
export const PROVIDER_NAMES: Record<ProviderName, string> = { rpcfast: 'RPC Fast', solami: 'Solami', custom: 'custom RPC', public: 'public' };
/** A configured provider with a key, as opposed to the plain endpoint everything falls back to. */
export const isProvider = (p: ProviderName) => p === 'rpcfast' || p === 'solami';

const clean = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);
const toWs = (http: string) => http.replace(/^http/, 'ws');
/** Appends the key, unless the URL already carries one (a URL copied whole from the dashboard). */
const withKey = (url: string, key: string | undefined) => (!key || /[?&]api_key=/.test(url) ? url : `${url}${url.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(key)}`);
const keyIn = (url: string | undefined) => { try { return url ? new URL(url).searchParams.get('api_key') ?? undefined : undefined; } catch { return undefined; } };

/** The endpoints used with no provider: a custom RPC if one is set, the public one otherwise. */
function plainEndpoints(env: Env): Pair {
  const http = clean(env.SOLANA_RPC) ?? clean(env.NEXT_PUBLIC_SOLANA_RPC) ?? PUBLIC_RPC;
  const provider: ProviderName = http === PUBLIC_RPC ? 'public' : 'custom';
  return { http: { provider, url: http }, ws: { provider, url: clean(env.SOLANA_WS) ?? toWs(http) } };
}

/** RPC Fast, when RPCFAST_API_KEY (or a URL carrying the key) is set. Both paths, since every plan has WebSocket access. */
function rpcfastEndpoints(env: Env): Pair | null {
  const rpcUrl = clean(env.RPCFAST_RPC_URL), wsUrl = clean(env.RPCFAST_WS_URL);
  const key = clean(env.RPCFAST_API_KEY) ?? keyIn(rpcUrl) ?? keyIn(wsUrl);
  if (!key && !rpcUrl) return null;
  return { http: { provider: 'rpcfast', url: withKey(rpcUrl ?? RPCFAST_RPC, key) }, ws: { provider: 'rpcfast', url: withKey(wsUrl ?? RPCFAST_WS, key) } };
}

/** Solami, when SOLAMI_API_KEY (or a URL carrying the key) is set. The stream stays on `plain` when there is nothing to open a socket with. */
function solamiEndpoints(env: Env, plain: Pair): Pair | null {
  const rpcUrl = clean(env.SOLAMI_RPC_URL), wsUrl = clean(env.SOLAMI_WS_URL);
  const key = clean(env.SOLAMI_API_KEY) ?? keyIn(rpcUrl);
  if (!key && !rpcUrl) return null;
  const region = clean(env.SOLAMI_REGION)?.toLowerCase();
  const pin = region && SOLAMI_REGIONS.includes(region) ? `${region}.` : ''; // anything else: global, nearest point of presence
  return {
    http: { provider: 'solami', url: withKey(rpcUrl ?? `https://${pin}rpc.solami.dev/sol`, key) },
    ws: key || wsUrl ? { provider: 'solami', url: withKey(wsUrl ?? `wss://${pin}ws.solami.dev/ws/sol`, key) } : plain.ws,
  };
}

export function chainEndpoints(env: Env = process.env): ChainEndpoints {
  const plain = plainEndpoints(env);
  const rpcfast = rpcfastEndpoints(env), solami = solamiEndpoints(env, plain);
  const want = clean(env.CHAIN_PROVIDER)?.toLowerCase();
  // the named provider when it is configured; otherwise RPC Fast first, then Solami
  const chosen = (want === 'solami' && solami) || (want === 'rpcfast' && rpcfast) || rpcfast || solami;
  if (!chosen) return { ...plain, fallback: null };
  return { ...chosen, fallback: plain };
}

/** Host only, for health output and logs: the key lives in the query string and must never be printed. */
export function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return 'invalid-url'; }
}

/**
 * A refusal is an answer that will not change on retry: the key is unknown or revoked (401), the balance is
 * empty (402), the key type or allowlist is wrong (403), or the plan has no WebSocket access (400 on the
 * upgrade). The provider is then left alone for a while and the fallback endpoint carries the traffic.
 */
const REFUSAL_HOLD_MS = 30 * 60_000;
const refusedUntil: Record<Kind, number> = { http: 0, ws: 0 };
export const isRefusal = (kind: Kind, status: number) => status === 401 || status === 402 || status === 403 || (kind === 'ws' && status === 400);
export function markRefused(kind: Kind, now = Date.now()) { refusedUntil[kind] = now + REFUSAL_HOLD_MS; }
export function clearRefused() { refusedUntil.http = 0; refusedUntil.ws = 0; }

/** The endpoint to use right now: the provider when configured and not recently refused, the fallback otherwise. */
export function pickEndpoint(kind: Kind, ep: ChainEndpoints = chainEndpoints(), now = Date.now()): Endpoint {
  return ep.fallback && now < refusedUntil[kind] ? ep.fallback[kind] : ep[kind];
}

/** Spaces calls so no more than `rps` start in any second. Each call returns how long that caller should wait. */
export function spacer(rps: number) {
  let next = 0;
  return (now = Date.now()) => { const at = Math.max(now, next); next = at + 1000 / rps; return at - now; };
}

/**
 * Requests a second sent to each provider, inside its plan's limit rather than bursting into it. RPC Fast allows
 * 15 on the Start plan and 50 on Focus (RPCFAST_RPS, default 10); Solami allows 5 on the Free plan (SOLAMI_RPS,
 * default 4). The fallback endpoint is not paced here: its 429s are handled by the caller's backoff.
 */
const DEFAULT_RPS: Record<'rpcfast' | 'solami', { env: string; rps: number }> = { rpcfast: { env: 'RPCFAST_RPS', rps: 10 }, solami: { env: 'SOLAMI_RPS', rps: 4 } };
const gates: Partial<Record<ProviderName, () => number>> = {};
/** Milliseconds to wait before the next call to `provider`; 0 for the plain endpoints. */
export function paceWait(provider: ProviderName, env: Env = process.env): number {
  if (!isProvider(provider)) return 0;
  const d = DEFAULT_RPS[provider];
  gates[provider] ??= spacer(Math.max(1, Number(env[d.env]) || d.rps));
  return gates[provider]!();
}
