import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PUBLIC_RPC, chainEndpoints, clearRefused, hostOf, isRefusal, markRefused, pickEndpoint, spacer } from '../src/lib/solami';

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

test('hostOf: what health and logs print never carries the key', () => {
  assert.equal(hostOf(chainEndpoints({ SOLAMI_API_KEY: 'sk_secret' }).ws.url), 'ws.solami.dev');
  assert.equal(hostOf('not a url'), 'invalid-url');
});

test('refusal: a refused key moves traffic to the fallback for half an hour, then Solami is tried again', () => {
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
