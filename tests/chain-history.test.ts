import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chainEndpoints, clearRefused } from '../src/lib/chain-endpoints';
import { clearHistoryProbe, fetchChainTape, historyEndpoint, historyHealth } from '../src/lib/chain-tape';
import { pathsLine } from '../src/lib/tape-stream';
import { PANTA_PROGRAM_MAINNET } from '../src/lib/panta-public';

const ORDER = 'Program log: Primary Order (USDC): side=Yes, amount=1000000, yes_price=500000000, no_price=500000000, minted=2000000';
const MARKET = 'EEg99KwxHF7uPwyeaGjuFiRGFLpP2K4UHX7gopAND9cu';
const now = () => Math.round(Date.now() / 1000);

/** A fake chain: `recent` keeps about a day of ledger, `archive` keeps everything. Every call is logged by host. */
function fakeChain(opts: { marketSigs: number; recentKeeps: number }) {
  const calls: string[] = [];
  const sig = (i: number) => `SIG${i}`;
  const all = Array.from({ length: opts.marketSigs }, (_, i) => ({ signature: sig(i), slot: 452_000_000 - i, blockTime: now() - 86400 * 30 + i, err: null }));
  const programRows = (deep: boolean) => Array.from({ length: deep ? 1000 : 8 }, (_, i) => ({ signature: `P${i}`, slot: 452_300_000 - i, blockTime: now() - (deep ? 86400 * 40 : 3600) * (i / 1000 + 0.01), err: null }));
  const answer = (host: string, method: string, params: unknown[]) => {
    const deep = host !== 'recent.example';
    if (method === 'getSignaturesForAddress') {
      const [addr] = params as [string];
      if (addr === PANTA_PROGRAM_MAINNET) return programRows(deep);
      return deep ? all : all.slice(0, opts.recentKeeps);
    }
    if (method === 'getTransaction') return { blockTime: now() - 1000, meta: { err: null, logMessages: [ORDER] }, transaction: { message: { accountKeys: ['W1', MARKET] } } };
    return null;
  };
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const body = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
    calls.push(`${url.host} ${body.method}`);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: answer(url.host, body.method, body.params) }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { calls, count: (host: string, method?: string) => calls.filter((c) => c.startsWith(host) && (!method || c.endsWith(method))).length };
}

const realFetch = globalThis.fetch;
const env = (e: Record<string, string>) => { for (const k of ['RPCFAST_API_KEY', 'RPCFAST_RPC_URL', 'SOLAMI_API_KEY', 'SOLAMI_RPC_URL', 'SOLANA_RPC', 'CHAIN_PROVIDER']) delete process.env[k]; Object.assign(process.env, e); };
const reset = () => { globalThis.fetch = realFetch; env({}); clearHistoryProbe(); clearRefused(); };

test('history: the endpoint model names the other provider, else the plain endpoint, for deep reads', () => {
  assert.equal(chainEndpoints({ RPCFAST_API_KEY: 'a', SOLAMI_API_KEY: 'b' }).history.provider, 'solami');
  assert.equal(chainEndpoints({ RPCFAST_API_KEY: 'a', SOLAMI_API_KEY: 'b', CHAIN_PROVIDER: 'solami' }).history.provider, 'rpcfast');
  assert.equal(chainEndpoints({ RPCFAST_API_KEY: 'a' }).history.provider, 'public');
  assert.equal(chainEndpoints({ SOLAMI_API_KEY: 'b', SOLANA_RPC: 'https://rpc.example.com' }).history.provider, 'custom');
  assert.equal(chainEndpoints({}).history.provider, 'public');
});

test('history: a provider that holds only recent ledger is found by the probe, and tape rebuilds go to the archive endpoint', async () => {
  env({ RPCFAST_RPC_URL: 'https://recent.example/?api_key=k', SOLAMI_RPC_URL: 'https://archive.example/sol?api_key=s' });
  const chain = fakeChain({ marketSigs: 40, recentKeeps: 0 });
  try {
    assert.equal((await historyEndpoint()).provider, 'solami', 'the probe saw 8 recent program signatures on the provider and chose the archive');
    assert.equal(chain.count('recent.example', 'getSignaturesForAddress'), 1, 'one probe call');
    const tape = await fetchChainTape(MARKET, { expected: 40, concurrency: 2 });
    assert.equal(tape.signatures, 40);
    assert.equal(tape.trades.length, 40);
    assert.equal(chain.count('archive.example', 'getSignaturesForAddress'), 1);
    assert.equal(chain.count('archive.example', 'getTransaction'), 40, 'the transactions are read where the signatures were');
    assert.equal(chain.count('recent.example', 'getTransaction'), 0);
    assert.equal((await historyEndpoint()).provider, 'solami', 'the answer is kept for an hour');
    assert.equal(chain.count('recent.example', 'getSignaturesForAddress'), 1, 'no second probe');
    const h = historyHealth();
    assert.deepEqual([h.provider, h.host, h.probed], ['solami', 'archive.example', true]);
    assert.match(h.note ?? '', /RPC Fast keeps only recent ledger; tape rebuilds read history over Solami/);
    assert.equal(pathsLine({ provider: 'rpcfast', host: 'recent.example', fallback: false }, { enabled: false } as never, h), 'RPC: RPC Fast, stream: off, history: Solami');
  } finally { reset(); }
});

test('history: a provider that keeps everything answers history itself, and the line names no separate path', async () => {
  env({ SOLAMI_RPC_URL: 'https://archive.example/sol?api_key=s' });
  const chain = fakeChain({ marketSigs: 12, recentKeeps: 12 });
  try {
    assert.equal((await historyEndpoint()).provider, 'solami');
    const tape = await fetchChainTape(MARKET, { expected: 12 });
    assert.equal(tape.trades.length, 12);
    assert.equal(chain.count('archive.example', 'getSignaturesForAddress'), 2, 'probe plus the market');
    const h = historyHealth();
    assert.deepEqual([h.provider, h.probed, h.note], ['solami', true, null]);
    assert.equal(pathsLine({ provider: 'solami', host: 'archive.example', fallback: false }, { enabled: false } as never, h), 'RPC: Solami, stream: off');
  } finally { reset(); }
});

test('history: a rebuild that comes up short against the chain count overrides a probe that said history was there', async () => {
  env({ RPCFAST_RPC_URL: 'https://recent.example/?api_key=k' });
  // the program probe looks deep enough (a full page), but this market reaches further back than the node keeps
  const chain = fakeChain({ marketSigs: 40, recentKeeps: 5 });
  globalThis.fetch = ((orig) => (async (input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { method: string; params: [string] };
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.host === 'recent.example' && body.method === 'getSignaturesForAddress' && body.params[0] === PANTA_PROGRAM_MAINNET) {
      chain.calls.push('recent.example getSignaturesForAddress');
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: Array.from({ length: 1000 }, (_, i) => ({ signature: `P${i}`, slot: 1, blockTime: now() - i, err: null })) }));
    }
    return orig(input, init);
  }) as typeof fetch)(globalThis.fetch);
  try {
    assert.equal((await historyEndpoint()).provider, 'rpcfast', 'the probe was fooled by a busy day');
    const tape = await fetchChainTape(MARKET, { expected: 40 });
    assert.equal(tape.trades.length, 40, 'the short list was thrown away and the archive read instead');
    assert.equal(chain.count('recent.example', 'getSignaturesForAddress'), 2, 'probe plus the short market read');
    assert.equal(chain.count('api.mainnet-beta.solana.com', 'getSignaturesForAddress'), 1);
    assert.equal((await historyEndpoint()).provider, 'public', 'and the provider is now marked as lacking history');
    assert.equal(historyHealth().provider, 'public');
    assert.equal(pathsLine({ provider: 'rpcfast', host: 'recent.example', fallback: false }, { enabled: false } as never, historyHealth()), 'RPC: RPC Fast, stream: off, history: public');
  } finally { reset(); }
});

test('history: with no provider there is nothing to route, and health says so', async () => {
  env({});
  const chain = fakeChain({ marketSigs: 3, recentKeeps: 3 });
  try {
    assert.equal((await historyEndpoint()).provider, 'public');
    assert.equal(chain.calls.length, 0, 'no probe on the plain endpoint');
    assert.deepEqual(historyHealth(), { provider: 'public', host: 'api.mainnet-beta.solana.com', probed: null, note: null });
  } finally { reset(); }
});
