import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PUBLIC_RPC, RPCFAST_RPC, RPCFAST_WS, chainEndpoints, clearRefused, hostOf, isRefusal, markRefused, paceWait, pickEndpoint, spacer } from '../src/lib/chain-endpoints';

test('endpoints: with no key and no override, the public mainnet endpoint carries both RPC and the stream', () => {
  const ep = chainEndpoints({});
  assert.deepEqual(ep.http, { provider: 'public', url: PUBLIC_RPC });
  assert.deepEqual(ep.ws, { provider: 'public', url: 'wss://api.mainnet-beta.solana.com' });
  assert.equal(ep.fallback, null);
});

test('endpoints: with no key, SOLANA_RPC wins over NEXT_PUBLIC_SOLANA_RPC and the socket URL follows it', () => {
  const ep = chainEndpoints({ SOLANA_RPC: 'https://rpc.example.com/abc', NEXT_PUBLIC_SOLANA_RPC: 'https://other.example.com' });
  assert.deepEqual(ep.http, { provider: 'custom', url: 'https://rpc.example.com/abc' });
  assert.equal(ep.ws.url, 'wss://rpc.example.com/abc');
  assert.equal(chainEndpoints({ NEXT_PUBLIC_SOLANA_RPC: 'https://other.example.com' }).http.url, 'https://other.example.com');
  assert.equal(chainEndpoints({ SOLANA_RPC: 'https://rpc.example.com', SOLANA_WS: 'wss://ws.example.com/x' }).ws.url, 'wss://ws.example.com/x');
  assert.equal(chainEndpoints({ SOLAMI_API_KEY: '  ' }).http.provider, 'public', 'a blank key is no key');
});

test('endpoints: a Solami key puts RPC and the stream on Solami, key in the query string', () => {
  const ep = chainEndpoints({ SOLAMI_API_KEY: 'sk_test123' });
  assert.deepEqual(ep.http, { provider: 'solami', url: 'https://rpc.solami.dev/sol?api_key=sk_test123' });
  assert.deepEqual(ep.ws, { provider: 'solami', url: 'wss://ws.solami.dev/ws/sol?api_key=sk_test123' });
  assert.deepEqual(ep.fallback?.http, { provider: 'public', url: PUBLIC_RPC }, 'what ran before the key is kept as the fallback');
  assert.equal(chainEndpoints({ SOLAMI_API_KEY: 'a b&c' }).http.url, 'https://rpc.solami.dev/sol?api_key=a%20b%26c');
});

test('endpoints: SOLAMI_REGION pins the host, and an unknown region stays global', () => {
  const fra = chainEndpoints({ SOLAMI_API_KEY: 'k', SOLAMI_REGION: 'FRA' });
  assert.equal(fra.http.url, 'https://fra.rpc.solami.dev/sol?api_key=k');
  assert.equal(fra.ws.url, 'wss://fra.ws.solami.dev/ws/sol?api_key=k');
  assert.equal(chainEndpoints({ SOLAMI_API_KEY: 'k', SOLAMI_REGION: 'mars' }).http.url, 'https://rpc.solami.dev/sol?api_key=k');
});

test('endpoints: SOLAMI_RPC_URL and SOLAMI_WS_URL replace the base, and the key is still appended', () => {
  const ep = chainEndpoints({ SOLAMI_API_KEY: 'k', SOLAMI_RPC_URL: 'https://rpc.solami.dev/sol/fra', SOLAMI_WS_URL: 'wss://nyc.ws.solami.dev/ws/sol?x=1' });
  assert.equal(ep.http.url, 'https://rpc.solami.dev/sol/fra?api_key=k');
  assert.equal(ep.ws.url, 'wss://nyc.ws.solami.dev/ws/sol?x=1&api_key=k');
});

test('endpoints: a URL copied whole from the dashboard is used as given, with no SOLAMI_API_KEY needed', () => {
  const ep = chainEndpoints({ SOLAMI_RPC_URL: 'https://fra.rpc.solami.dev/sol?api_key=rpc_abc' });
  assert.deepEqual(ep.http, { provider: 'solami', url: 'https://fra.rpc.solami.dev/sol?api_key=rpc_abc' });
  assert.equal(ep.ws.url, 'wss://ws.solami.dev/ws/sol?api_key=rpc_abc', 'the socket reuses the key found in the RPC URL');
  assert.equal(chainEndpoints({ SOLAMI_API_KEY: 'other', SOLAMI_RPC_URL: 'https://rpc.solami.dev/sol?api_key=rpc_abc' }).http.url, 'https://rpc.solami.dev/sol?api_key=rpc_abc', 'a key already in the URL is not doubled');
  const keyless = chainEndpoints({ SOLAMI_RPC_URL: 'https://rpc.solami.dev/sol/some-path-key' });
  assert.equal(keyless.http.provider, 'solami');
  assert.equal(keyless.ws.provider, 'public', 'no key and no socket URL: the stream stays on the fallback endpoint');
});

test('endpoints: an RPC Fast key puts RPC and the stream on RPC Fast, one host for both, key in the query string', () => {
  const ep = chainEndpoints({ RPCFAST_API_KEY: 'rf_key1' });
  assert.deepEqual(ep.http, { provider: 'rpcfast', url: `${RPCFAST_RPC}?api_key=rf_key1` });
  assert.deepEqual(ep.ws, { provider: 'rpcfast', url: `${RPCFAST_WS}?api_key=rf_key1` });
  assert.equal(ep.http.url, 'https://solana-rpc.rpcfast.com/?api_key=rf_key1', 'the dashboard shows this exact form');
  assert.equal(ep.ws.url, 'wss://solana-rpc.rpcfast.com/?api_key=rf_key1');
  assert.deepEqual(ep.fallback?.http, { provider: 'public', url: PUBLIC_RPC }, 'what ran before the key is kept as the fallback');
  assert.equal(chainEndpoints({ RPCFAST_API_KEY: ' ' }).http.provider, 'public', 'a blank key is no key');
});

test('endpoints: RPC Fast URLs copied whole from the dashboard are used as given, and the key found in one serves the other', () => {
  const both = chainEndpoints({ RPCFAST_RPC_URL: 'https://solana-rpc.rpcfast.com/?api_key=rf_abc' });
  assert.equal(both.http.url, 'https://solana-rpc.rpcfast.com/?api_key=rf_abc');
  assert.equal(both.ws.url, 'wss://solana-rpc.rpcfast.com/?api_key=rf_abc', 'the socket reuses the key found in the RPC URL');
  const ws = chainEndpoints({ RPCFAST_API_KEY: 'k', RPCFAST_WS_URL: 'wss://other.rpcfast.com/ws?x=1' });
  assert.equal(ws.ws.url, 'wss://other.rpcfast.com/ws?x=1&api_key=k');
  assert.equal(ws.http.url, 'https://solana-rpc.rpcfast.com/?api_key=k');
  assert.equal(chainEndpoints({ RPCFAST_API_KEY: 'other', RPCFAST_RPC_URL: 'https://solana-rpc.rpcfast.com/?api_key=rf_abc' }).http.url, 'https://solana-rpc.rpcfast.com/?api_key=rf_abc', 'a key already in the URL is not doubled');
});

test('endpoints: with both keys RPC Fast is used, and CHAIN_PROVIDER picks explicitly when that provider is configured', () => {
  const env = { RPCFAST_API_KEY: 'rf', SOLAMI_API_KEY: 'sm' };
  assert.equal(chainEndpoints(env).http.provider, 'rpcfast');
  assert.equal(chainEndpoints({ ...env, CHAIN_PROVIDER: 'solami' }).http.provider, 'solami');
  assert.equal(chainEndpoints({ ...env, CHAIN_PROVIDER: 'Solami ' }).ws.provider, 'solami', 'case and spaces do not matter');
  assert.equal(chainEndpoints({ ...env, CHAIN_PROVIDER: 'rpcfast' }).http.provider, 'rpcfast');
  assert.equal(chainEndpoints({ SOLAMI_API_KEY: 'sm', CHAIN_PROVIDER: 'rpcfast' }).http.provider, 'solami', 'naming a provider with no key falls through to the one that has a key');
  assert.equal(chainEndpoints({ RPCFAST_API_KEY: 'rf', CHAIN_PROVIDER: 'solami' }).http.provider, 'rpcfast');
  assert.equal(chainEndpoints({ CHAIN_PROVIDER: 'rpcfast' }).http.provider, 'public');
  assert.equal(chainEndpoints({ ...env, SOLANA_RPC: 'https://rpc.example.com' }).fallback?.http.provider, 'custom', 'the fallback is the plain endpoint, never the other provider');
});

test('pace: each provider is spaced to its own rate, and the plain endpoints are not paced', () => {
  assert.equal(paceWait('public'), 0);
  assert.equal(paceWait('custom'), 0);
  const first = paceWait('rpcfast', { RPCFAST_RPS: '10' });
  const second = paceWait('rpcfast', { RPCFAST_RPS: '10' });
  assert.equal(first, 0, 'the first call goes at once');
  assert.ok(second > 0 && second <= 100, `the second waits for the 100 ms slot, got ${second}`);
  assert.equal(paceWait('solami', { SOLAMI_RPS: '4' }), 0, 'a different provider has its own gate');
});

test('hostOf: what health and logs print never carries the key', () => {
  assert.equal(hostOf(chainEndpoints({ SOLAMI_API_KEY: 'sk_secret' }).ws.url), 'ws.solami.dev');
  assert.equal(hostOf('not a url'), 'invalid-url');
});

test('refusal: a refused key moves traffic to the fallback for half an hour, then the provider is tried again', () => {
  clearRefused();
  const ep = chainEndpoints({ SOLAMI_API_KEY: 'k' });
  const t0 = 1_790_000_000_000;
  assert.equal(pickEndpoint('ws', ep, t0).provider, 'solami');
  markRefused('ws', t0);
  assert.equal(pickEndpoint('ws', ep, t0 + 60_000).provider, 'public');
  assert.equal(pickEndpoint('http', ep, t0 + 60_000).provider, 'solami', 'a Free plan key has RPC but no WebSocket: only the stream moves');
  assert.equal(pickEndpoint('ws', ep, t0 + 31 * 60_000).provider, 'solami');
  markRefused('http', t0);
  assert.equal(pickEndpoint('http', chainEndpoints({}), t0).provider, 'public', 'with no key there is nothing to fall back from');
  clearRefused();
  const rf = chainEndpoints({ RPCFAST_API_KEY: 'k' });
  markRefused('http', t0);
  assert.equal(pickEndpoint('http', rf, t0 + 1000).provider, 'public', 'RPC Fast follows the same rule');
  assert.equal(pickEndpoint('ws', rf, t0 + 1000).provider, 'rpcfast');
  clearRefused();
});

test('refusal: only answers a retry cannot change count', () => {
  assert.equal(isRefusal('http', 401), true);
  assert.equal(isRefusal('http', 402), true);
  assert.equal(isRefusal('http', 403), true);
  assert.equal(isRefusal('ws', 400), true, 'the plan has no WebSocket access');
  assert.equal(isRefusal('http', 400), false);
  assert.equal(isRefusal('http', 429), false, 'rate limits are retried with backoff');
  assert.equal(isRefusal('ws', 503), false);
});

test('spacer: calls are paced to the plan rate, and an idle gap is not saved up as a burst', () => {
  const wait = spacer(4);
  const t0 = 1_790_000_000_000;
  assert.deepEqual([wait(t0), wait(t0), wait(t0), wait(t0 + 100)], [0, 250, 500, 650]);
  assert.equal(wait(t0 + 10_000), 0);
  assert.equal(wait(t0 + 10_000), 250);
});
