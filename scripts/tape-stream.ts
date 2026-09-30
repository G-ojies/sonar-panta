/**
 * Watch the live tape stream from a terminal.
 *   npm run stream                  # subscribe and print every Panta transaction the node pushes
 *   npm run stream -- --replay 5    # first push the program's last 5 transactions through the same decode path
 * Connects to the endpoint the server would use: Solami with SOLAMI_API_KEY set, the public one without.
 * Reads the market registry from the store named by .env.local and writes nothing: decoded prints are printed
 * here, not stored. The server's own stream (started by /api/health) is the one that stores them.
 */
import { config as dotenv } from 'dotenv';
dotenv({ path: '.env.local' }); dotenv();
import { rpc, type ChainTapeCache, type Tx } from '../src/lib/chain-tape';
import { PANTA_PROGRAM_MAINNET } from '../src/lib/panta-public';
import { chainEndpoints, hostOf, pickEndpoint } from '../src/lib/solami';
import { store } from '../src/lib/store';
import { TapeStream, openSocket, type SocketHandlers } from '../src/lib/tape-stream';

const at = () => new Date().toISOString().slice(11, 19);
const replayIdx = process.argv.indexOf('--replay');
const replay = replayIdx > -1 ? Number(process.argv[replayIdx + 1] || 5) : 0;

// reads fall through to the real store, writes stay in this process
const local = new Map<string, unknown>();
const readOnly = {
  async get<T>(k: string): Promise<T | null> { return local.has(k) ? (local.get(k) as T) : store().get<T>(k); },
  async set(k: string, v: unknown) {
    if (k.startsWith('sonar:chaintape:')) {
      const had = new Set(((await readOnly.get<ChainTapeCache>(k))?.trades ?? []).map((t) => t.id));
      for (const t of (v as ChainTapeCache).trades.filter((x) => !had.has(x.id))) {
        const lag = t.blockTime ? Math.round(Date.now() / 1000 - t.blockTime) : null;
        console.log(`[${at()}] print   ${t.side.toUpperCase().padEnd(3)} ${Number(t.shares).toFixed(2)} shares, YES ${((t.price ?? 0) * 100).toFixed(1)}c after  market ${t.marketId}  tx ${t.signature.slice(0, 12)}…  ${lag !== null && lag < 600 ? `${lag}s after the block` : 'from history'}`);
      }
    }
    local.set(k, v);
  },
};

const socket: { on: SocketHandlers | null } = { on: null };
const ep = chainEndpoints();
const stream = new TapeStream({
  endpoints: ep, rpc, store: readOnly, now: () => Date.now(), later: (fn, ms) => { setTimeout(fn, ms); },
  open: (url, on) => {
    console.log(`[${at()}] connect ${hostOf(url)}`);
    socket.on = on;
    return openSocket(url, { ...on, close: (code, status) => { console.log(`[${at()}] closed  code ${code}${status ? `, HTTP ${status}` : ''}`); on.close(code, status); } });
  },
});

const line = () => {
  const h = stream.health();
  console.log(`[${at()}] health  connected=${h.connected} provider=${h.provider}${h.fallback ? ' (Solami fallback)' : ''} host=${h.host} events=${h.events} prints=${h.prints} recovered=${h.recovered} unmapped=${h.unmapped} reconnects=${h.reconnects} lastSlot=${h.lastSlot ?? '-'}${h.note ? ` note="${h.note}"` : ''}`);
};

(async () => {
  console.log(`rpc ${pickEndpoint('http', ep).provider} (${hostOf(pickEndpoint('http', ep).url)}), stream ${pickEndpoint('ws', ep).provider} (${hostOf(pickEndpoint('ws', ep).url)}), program ${PANTA_PROGRAM_MAINNET}`);
  stream.start();
  setInterval(() => { stream.tick(); line(); }, 30_000);
  while (!stream.health().connected) await new Promise((r) => setTimeout(r, 250));
  await stream.idle();
  line();
  if (replay > 0) {
    // real transactions, fed in as the frames the node would have pushed: the decode and mapping path is the live one
    const rows = await rpc<{ signature: string; slot: number; err: unknown }[]>('getSignaturesForAddress', [PANTA_PROGRAM_MAINNET, { limit: replay }]);
    console.log(`[${at()}] replay  ${rows.length} recent program transactions`);
    for (const r of rows.reverse()) {
      const tx = await rpc<Tx | null>('getTransaction', [r.signature, { encoding: 'json', maxSupportedTransactionVersion: 0 }]);
      if (!tx) continue;
      socket.on?.message(JSON.stringify({ jsonrpc: '2.0', method: 'logsNotification', params: { result: { context: { slot: r.slot }, value: { signature: r.signature, err: tx.meta?.err ?? null, logs: tx.meta?.logMessages ?? [] } }, subscription: 0 } }));
      await stream.idle();
    }
    line();
  }
  console.log(`[${at()}] waiting for the next Panta transaction (ctrl-c to stop)`);
})().catch((e) => { console.error(e); process.exit(1); });
