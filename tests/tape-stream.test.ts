import { test } from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import { appendPrints, type ChainTapeCache, type Tx } from '../src/lib/chain-tape';
import { PANTA_PROGRAM_MAINNET } from '../src/lib/panta-public';
import { CHAIN_TAPE_KEY, KNOWN_IDS_KEY } from '../src/lib/radar';
import { chainEndpoints, clearRefused, type ChainEndpoints } from '../src/lib/solami';
import { TapeStream, backoffMs, marketOf, parseLogEvent, pathsLine, streamEnabled, subscribeFrame, type SocketHandlers } from '../src/lib/tape-stream';
import { print } from './helpers';

const USDC_LINE = 'Program log: Primary Order (USDC): side=No, amount=1727203, yes_price=499344245, no_price=500655755, minted=3440032';
const key = (n: number) => bs58.encode(Buffer.alloc(32, n));
const MARKET = key(7), NEW_MARKET = key(9), WALLET = key(1);
/** The event the program emits after an order: discriminator, market key, then fields the stream does not read. */
const eventLine = (market: string) => `Program data: ${Buffer.concat([Buffer.alloc(8, 1), Buffer.from(bs58.decode(market)), Buffer.alloc(40)]).toString('base64')}`;
const orderTx = (market: string, logs = ['Program log: Instruction: PrimaryOrderUsdc', USDC_LINE, eventLine(market)]): Tx => ({
  blockTime: 1_790_000_000, meta: { err: null, logMessages: logs }, transaction: { message: { accountKeys: [WALLET, key(2), key(3), market] } },
});
const frame = (signature: string, logs: string[], slot = 451_947_877, err: unknown = null) =>
  JSON.stringify({ jsonrpc: '2.0', method: 'logsNotification', params: { result: { context: { slot }, value: { signature, err, logs } }, subscription: 42 } });
const ACK = JSON.stringify({ jsonrpc: '2.0', result: 42, id: 1 });

/** A stream wired to fakes: sockets that the test drives by hand, a clock, a timer list, a canned RPC and a map for a store. */
function rig(opts: { endpoints?: ChainEndpoints; txs?: Record<string, Tx | null>; sigs?: { signature: string; slot: number; err: unknown }[]; known?: string[] } = {}) {
  const clock = { ms: 1_790_000_000_000 };
  const sockets: { url: string; on: SocketHandlers; sent: string[]; pings: number; terminated: boolean }[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const calls: { method: string; params: unknown[] }[] = [];
  const kv = new Map<string, unknown>([[KNOWN_IDS_KEY, opts.known ?? [MARKET]]]);
  const sigs = { rows: opts.sigs ?? [] };
  const stream = new TapeStream({
    endpoints: opts.endpoints ?? chainEndpoints({}),
    open: (url, on) => { const s = { url, on, sent: [] as string[], pings: 0, terminated: false }; sockets.push(s); return { send: (f) => { s.sent.push(f); }, ping: () => { s.pings++; }, terminate: () => { s.terminated = true; } }; },
    rpc: async <T>(method: string, params: unknown[]) => { calls.push({ method, params }); return (method === 'getTransaction' ? opts.txs?.[params[0] as string] ?? null : sigs.rows) as T; },
    store: { get: async <T>(k: string) => (kv.get(k) ?? null) as T | null, set: async (k, v) => { kv.set(k, v); } },
    later: (fn, ms) => { timers.push({ fn, ms }); },
    now: () => clock.ms,
  });
  const up = async () => { stream.start(); const s = sockets[sockets.length - 1]; s.on.open(); s.on.message(ACK); await stream.idle(); return s; };
  return { stream, sockets, timers, calls, kv, clock, sigs, up, tape: (id: string) => kv.get(CHAIN_TAPE_KEY(id)) as ChainTapeCache | undefined };
}

test('backoff: one second, doubling to a one-minute ceiling, with at most a quarter of jitter', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 20].map((n) => backoffMs(n, 0)), [1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
  assert.equal(backoffMs(0, 1), 1250);
  assert.equal(backoffMs(9, 1), 75000);
  for (let i = 0; i < 50; i++) { const d = backoffMs(2); assert.ok(d >= 4000 && d <= 5000); }
});

test('subscribe: one logsSubscribe, filtered by the node to transactions that mention the Panta program', () => {
  assert.deepEqual(JSON.parse(subscribeFrame()), { jsonrpc: '2.0', id: 1, method: 'logsSubscribe', params: [{ mentions: [PANTA_PROGRAM_MAINNET] }, { commitment: 'confirmed' }] });
});

test('parseLogEvent: a notification becomes an event, anything else is ignored', () => {
  assert.deepEqual(parseLogEvent(frame('SIG', [USDC_LINE], 99)), { signature: 'SIG', slot: 99, err: null, logs: [USDC_LINE] });
  assert.equal(parseLogEvent(ACK), null);
  assert.equal(parseLogEvent('not json'), null);
  assert.equal(parseLogEvent(JSON.stringify({ method: 'logsNotification', params: { result: { value: {} } } })), null);
});

test('marketOf: the account the registry knows is the market', () => {
  assert.equal(marketOf(orderTx(MARKET), new Set([MARKET, key(50)])), MARKET);
  const viaLookupTable: Tx = { ...orderTx(MARKET), transaction: { message: { accountKeys: [WALLET] } } };
  viaLookupTable.meta!.loadedAddresses = { writable: [MARKET], readonly: [] };
  assert.equal(marketOf(viaLookupTable, new Set([MARKET])), MARKET, 'a market loaded through an address lookup table still counts');
});

test('marketOf: a market created since the last scan is taken from the program event, but only if the transaction touches it', () => {
  assert.equal(marketOf(orderTx(NEW_MARKET), new Set([MARKET])), NEW_MARKET);
  const stray = orderTx(NEW_MARKET, [USDC_LINE, eventLine(key(77))]);
  assert.equal(marketOf(stray, new Set([MARKET])), null, 'the event names an account the transaction does not carry');
  assert.equal(marketOf(orderTx(NEW_MARKET, [USDC_LINE]), new Set()), null, 'no event and no registry hit: left for the scan');
  const two: Tx = { ...orderTx(MARKET), transaction: { message: { accountKeys: [WALLET, MARKET, NEW_MARKET] } } };
  assert.equal(marketOf(two, new Set([MARKET, NEW_MARKET])), MARKET, 'two known markets in one transaction: the event decides');
});

test('appendPrints: a streamed print is added once, newest first, and the rebuild time is left alone', () => {
  const cache: ChainTapeCache = { ts: 500, trades: [print('yes', 5, 100, { id: 'A', signature: 'A' })], signatures: 1, complete: true };
  const out = appendPrints(cache, [print('no', 7, 200, { id: 'B', signature: 'B' }), print('yes', 5, 100, { id: 'A', signature: 'A' })]);
  assert.deepEqual(out.trades.map((t) => t.id), ['B', 'A']);
  assert.equal(out.ts, 500);
  assert.equal(out.signatures, 2);
  assert.equal(appendPrints(cache, [cache.trades[0]]), cache, 'nothing new: the same object back, so nothing is written');
  assert.equal(appendPrints(null, [print('no', 1, 0)]).ts, 0, 'a tape that starts from the stream is due a full rebuild');
});

test('stream: on open it subscribes, and is connected once the node confirms', async () => {
  const r = rig();
  r.stream.start();
  assert.equal(r.sockets[0].url, 'wss://api.mainnet-beta.solana.com');
  assert.equal(r.stream.health().connected, false);
  r.sockets[0].on.open();
  assert.deepEqual(r.sockets[0].sent, [subscribeFrame()]);
  r.sockets[0].on.message(ACK);
  await r.stream.idle();
  const h = r.stream.health();
  assert.equal(h.connected, true);
  assert.equal(h.provider, 'public');
  assert.equal(h.host, 'api.mainnet-beta.solana.com');
  assert.equal(h.fallback, false);
  // first run: no cursor in the store, so the catch-up only records where the chain is now
  assert.deepEqual(r.calls, [{ method: 'getSignaturesForAddress', params: [PANTA_PROGRAM_MAINNET, { commitment: 'confirmed', limit: 1 }] }]);
});

test('stream: an order line pushed by the node becomes a print on its market tape, decoded by the scan decoder', async () => {
  const r = rig({ txs: { SIG1: orderTx(MARKET) } });
  const s = await r.up();
  s.on.message(frame('SIG1', orderTx(MARKET).meta!.logMessages!));
  await r.stream.idle();
  const tape = r.tape(MARKET)!;
  assert.equal(tape.trades.length, 1);
  const p = tape.trades[0];
  assert.deepEqual([p.id, p.marketId, p.wallet, p.side, p.price, p.amountUsdc, p.shares, p.source], ['SIG1', MARKET, WALLET, 'no', 0.499344245, '1.727203', '3.440032', 'chain']);
  assert.equal(tape.ts, 0, 'a fresh tape is marked for a full rebuild by the next scan');
  const h = r.stream.health();
  assert.deepEqual([h.events, h.prints, h.recovered, h.unmapped, h.lastSlot], [1, 1, 0, 0, 451_947_877]);
  assert.equal(h.lastPrintAt, Math.round(r.clock.ms / 1000));
  assert.deepEqual(r.calls[1], { method: 'getTransaction', params: ['SIG1', { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }] });
});

test('stream: a print is stored once however often it arrives, and joins the prints already on the tape', async () => {
  const r = rig({ txs: { SIG1: orderTx(MARKET), SIG2: { ...orderTx(MARKET), blockTime: 1_790_000_060 } } });
  r.kv.set(CHAIN_TAPE_KEY(MARKET), { ts: 123, trades: [print('yes', 5, -600, { id: 'OLD', signature: 'OLD', source: 'chain' })], signatures: 1, complete: false });
  const s = await r.up();
  const logs = orderTx(MARKET).meta!.logMessages!;
  s.on.message(frame('SIG1', logs)); s.on.message(frame('SIG1', logs)); s.on.message(frame('SIG2', logs, 451_947_900));
  await r.stream.idle();
  assert.deepEqual(r.tape(MARKET)!.trades.map((t) => t.id), ['SIG2', 'SIG1', 'OLD']);
  assert.equal(r.tape(MARKET)!.ts, 123);
  assert.equal(r.stream.health().prints, 2);
  assert.equal(r.calls.filter((c) => c.method === 'getTransaction').length, 2);
});

test('stream: transactions without an order, and failed ones, cost no fetch and store nothing', async () => {
  const r = rig({ txs: { SIG1: orderTx(MARKET) } });
  const s = await r.up();
  s.on.message(frame('GRAD', ['Program log: Instruction: GraduateMarketUsdc']));
  s.on.message(frame('FAIL', [USDC_LINE], 451_947_878, { InstructionError: [0, 'Custom'] }));
  await r.stream.idle();
  assert.equal(r.calls.filter((c) => c.method === 'getTransaction').length, 0);
  assert.equal(r.tape(MARKET), undefined);
  assert.deepEqual([r.stream.health().events, r.stream.health().prints], [2, 0]);
});

test('stream: a transaction the node does not serve yet is fetched again shortly, then left for the scan', async () => {
  const txs: Record<string, Tx | null> = { SIG1: null, SIG2: null };
  const r = rig({ txs });
  const s = await r.up();
  const logs = orderTx(MARKET).meta!.logMessages!;
  s.on.message(frame('SIG1', logs));
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(r.timers.map((t) => t.ms), [1500]);
  txs.SIG1 = orderTx(MARKET);
  r.timers[0].fn();
  await r.stream.idle();
  assert.deepEqual(r.tape(MARKET)!.trades.map((t) => t.id), ['SIG1']);

  s.on.message(frame('SIG2', logs));
  for (let i = 1; i <= 2; i++) { await new Promise((done) => setImmediate(done)); r.timers[i].fn(); }
  await r.stream.idle();
  assert.equal(r.calls.filter((c) => c.params[0] === 'SIG2').length, 3);
  assert.equal(r.stream.health().prints, 1);
  assert.match(r.stream.health().note ?? '', /not served yet/);
});

test('stream: an order on a market nobody can identify is counted and left for the scan', async () => {
  const r = rig({ txs: { SIG1: orderTx(NEW_MARKET, [USDC_LINE]) }, known: [] });
  const s = await r.up();
  s.on.message(frame('SIG1', [USDC_LINE]));
  await r.stream.idle();
  assert.equal(r.stream.health().unmapped, 1);
  assert.equal(r.stream.health().prints, 0);
});

test('reconnect: a dropped socket is reopened after the backoff, and the gap is closed from the last signature handled', async () => {
  const r = rig({ txs: { SIG1: orderTx(MARKET), MISSED: { ...orderTx(MARKET), blockTime: 1_790_000_300 } } });
  const s = await r.up();
  s.on.message(frame('SIG1', orderTx(MARKET).meta!.logMessages!, 451_947_877));
  await r.stream.idle();

  r.clock.ms += 5 * 60_000;
  s.on.close(1006, null);
  assert.equal(r.stream.health().connected, false);
  assert.equal(r.stream.health().reconnects, 1);
  assert.equal(r.timers.length, 1);
  assert.ok(r.timers[0].ms >= 1000 && r.timers[0].ms <= 1250, 'first retry after about a second');

  // while the socket was down the program took one order and one unrelated transaction
  r.sigs.rows = [{ signature: 'OTHER', slot: 451_948_400, err: null }, { signature: 'MISSED', slot: 451_948_300, err: null }, { signature: 'BAD', slot: 451_948_200, err: {} }];
  r.calls.length = 0;
  r.timers[0].fn();
  assert.equal(r.sockets.length, 2);
  r.sockets[1].on.open(); r.sockets[1].on.message(ACK);
  await r.stream.idle();
  assert.deepEqual(r.calls[0], { method: 'getSignaturesForAddress', params: [PANTA_PROGRAM_MAINNET, { commitment: 'confirmed', limit: 50, until: 'SIG1' }] });
  assert.deepEqual(r.calls.slice(1).map((c) => c.params[0]), ['MISSED', 'OTHER'], 'oldest first, failed transactions skipped');
  assert.deepEqual(r.tape(MARKET)!.trades.map((t) => t.id), ['MISSED', 'SIG1']);
  const h = r.stream.health();
  assert.deepEqual([h.connected, h.prints, h.recovered, h.lastSlot], [true, 1, 1, 451_948_400]);

  // the cursor is saved by the keepalive tick, so a restarted process picks up from here
  r.stream.tick();
  assert.deepEqual(r.kv.get('sonar:stream:cursor'), { signature: 'OTHER', slot: 451_948_400 });
  assert.equal(r.sockets[1].pings, 1);
});

test('reconnect: a restarted process closes the gap from the cursor in the store', async () => {
  const r = rig({ txs: { MISSED: orderTx(MARKET) }, sigs: [{ signature: 'MISSED', slot: 451_948_300, err: null }] });
  r.kv.set('sonar:stream:cursor', { signature: 'BEFORE', slot: 451_900_000 });
  await r.up();
  assert.deepEqual((r.calls[0].params[1] as { until?: string }).until, 'BEFORE');
  assert.equal(r.stream.health().recovered, 1);
  assert.equal(r.stream.health().prints, 0, 'recovered prints are not counted as streamed');
});

test('reconnect: the delay doubles while connects keep failing and resets only after a connection has held', async () => {
  const r = rig();
  r.stream.start();
  for (let i = 0; i < 4; i++) { r.sockets[i].on.close(1006, null); r.timers[i].fn(); }
  r.timers.forEach((t, i) => assert.ok(t.ms >= 1000 * 2 ** i && t.ms <= 1250 * 2 ** i, `retry ${i} waits about ${2 ** i}s`));
  assert.equal(r.stream.health().reconnects, 4);

  // a connection that drops right after subscribing does not reset the backoff
  r.sockets[4].on.open(); r.sockets[4].on.message(ACK); await r.stream.idle();
  r.clock.ms += 5_000; r.sockets[4].on.close(1006, null);
  assert.ok(r.timers[4].ms >= 16_000);
  // one that held for a minute does
  r.timers[4].fn(); r.sockets[5].on.open(); r.sockets[5].on.message(ACK); await r.stream.idle();
  r.clock.ms += 61_000; r.sockets[5].on.close(1001, null);
  assert.ok(r.timers[5].ms <= 1250);
});

test('reconnect: a socket that goes silent is dropped by the keepalive, a live one is pinged', async () => {
  const r = rig();
  const s = await r.up();
  r.clock.ms += 30_000; r.stream.tick();
  assert.deepEqual([s.pings, s.terminated], [1, false]);
  s.on.alive();
  r.clock.ms += 30_000; r.stream.tick();
  assert.deepEqual([s.pings, s.terminated], [2, false]);
  r.clock.ms += 80_000; r.stream.tick();
  assert.equal(s.terminated, true, 'no frame and no pong for over 75 s');
});

test('fallback: when Solami refuses the stream, the public endpoint carries it and health says why', async () => {
  clearRefused();
  const r = rig({ endpoints: chainEndpoints({ SOLAMI_API_KEY: 'sk_secret' }) });
  r.stream.start();
  assert.equal(r.sockets[0].url, 'wss://ws.solami.dev/ws/sol?api_key=sk_secret');
  assert.deepEqual([r.stream.health().provider, r.stream.health().host], ['solami', 'ws.solami.dev']);
  r.sockets[0].on.close(1006, 400); // the plan has no WebSocket access
  r.timers[0].fn();
  assert.equal(r.sockets[1].url, 'wss://api.mainnet-beta.solana.com');
  r.sockets[1].on.open(); r.sockets[1].on.message(ACK); await r.stream.idle();
  const h = r.stream.health();
  assert.deepEqual([h.connected, h.provider, h.fallback], [true, 'public', true]);
  assert.match(h.note ?? '', /Solami refused the stream \(HTTP 400\)/);
  assert.ok(!JSON.stringify(h).includes('sk_secret'), 'the key never reaches the health output');
  // half an hour later the next reconnect tries Solami again
  r.clock.ms += 31 * 60_000; r.sockets[1].on.close(1006, null); r.timers[1].fn();
  assert.equal(r.sockets[2].url, 'wss://ws.solami.dev/ws/sol?api_key=sk_secret');
  clearRefused();
});

test('fallback: health names the provider of each path, so a Free plan key reads as RPC on Solami and the stream on the public fallback', async () => {
  clearRefused();
  const r = rig({ endpoints: chainEndpoints({ SOLAMI_API_KEY: 'k' }) });
  r.stream.start();
  const solamiRpc = { provider: 'solami' as const, host: 'rpc.solami.dev', fallback: false };
  assert.equal(pathsLine(solamiRpc, r.stream.health()), 'RPC: Solami, stream: Solami (reconnecting)');
  r.sockets[0].on.close(1006, 400); r.timers[0].fn();
  r.sockets[1].on.open(); r.sockets[1].on.message(ACK); await r.stream.idle();
  assert.equal(pathsLine(solamiRpc, r.stream.health()), 'RPC: Solami, stream: public fallback');
  assert.equal(pathsLine({ provider: 'public', host: 'api.mainnet-beta.solana.com', fallback: true }, r.stream.health()), 'RPC: public fallback, stream: public fallback');
  assert.equal(pathsLine({ provider: 'public', host: 'api.mainnet-beta.solana.com', fallback: false }, { ...r.stream.health(), enabled: false }), 'RPC: public, stream: off');
  clearRefused();
});

test('fallback: an ordinary drop on Solami is retried on Solami', () => {
  clearRefused();
  const r = rig({ endpoints: chainEndpoints({ SOLAMI_API_KEY: 'k' }) });
  r.stream.start();
  r.sockets[0].on.close(1001, null); // routine node restart
  r.timers[0].fn();
  assert.equal(r.sockets[1].url, 'wss://ws.solami.dev/ws/sol?api_key=k');
  assert.equal(r.stream.health().fallback, false);
});

test('streamEnabled: on for a long-lived server, off on serverless hosts and during the build, and the switch wins', () => {
  assert.equal(streamEnabled({}), true);
  assert.equal(streamEnabled({ VERCEL: '1' }), false);
  assert.equal(streamEnabled({ NEXT_PHASE: 'phase-production-build' }), false);
  assert.equal(streamEnabled({ VERCEL: '1', SONAR_TAPE_STREAM: 'on' }), true);
  assert.equal(streamEnabled({ SONAR_TAPE_STREAM: 'off' }), false);
});
