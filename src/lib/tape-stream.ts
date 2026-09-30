/**
 * Live tape: the Panta program's log, pushed instead of fetched.
 *
 * One WebSocket holds one `logsSubscribe` with a `mentions` filter on the program, so the node sends a frame
 * only when a Panta transaction confirms (a handful a day) and nothing is ever polled. A frame that carries an
 * order line costs one getTransaction (for the signer, the block time and the accounts); the print is decoded
 * by the same code the scan uses (chain-tape.ts) and appended to the market's stored chain tape, so the market
 * page reads it seconds after the trade instead of on the next scan.
 *
 * The socket lives in the one Next.js server process, started by the first /api/health call after boot. That
 * process can restart or sleep, so nothing depends on the socket staying up: the newest signature handled is
 * kept in the store, and after every (re)connect a bounded getSignaturesForAddress closes the gap. The scan's
 * own rebuild remains the backstop. The endpoint is Solami when SOLAMI_API_KEY is set (see solami.ts).
 */
import bs58 from 'bs58';
import WebSocket from 'ws';
import { appendPrints, parseOrderLog, rpc as chainRpc, tradesFromTx, type ChainTapeCache, type Tx } from './chain-tape';
import { PANTA_PROGRAM_MAINNET } from './panta-public';
import { CHAIN_TAPE_KEY, KNOWN_IDS_KEY } from './radar';
import { chainEndpoints, hostOf, isRefusal, markRefused, pickEndpoint, type ChainEndpoints } from './solami';
import { store } from './store';
import type { ChainHealth, StreamHealth } from './types';

const CURSOR_KEY = 'sonar:stream:cursor';
/** Signatures read back after a reconnect. The program sees about ten transactions a day, so this covers days of downtime. */
const CATCHUP_MAX = 50;
const KEEPALIVE_MS = 30_000;
/** No frame and no pong for this long: the socket is dead even if it never said so. */
const DEAD_AFTER_MS = 75_000;
/** A connection has to last this long before the backoff starts again from one second. */
const STABLE_AFTER_MS = 60_000;
/** Fetches of a transaction the node just announced, before it is left for the scan. */
const TX_TRIES = 3;
/** Solami close codes that a reconnect will not fix: 4002 bandwidth and balance empty, 4029 connection cap reached. */
const REFUSAL_CLOSE_CODES = [4002, 4029];

interface Cursor { signature: string; slot: number }
interface SigRow { signature: string; slot: number; err: unknown }
export interface LogEvent { signature: string; slot: number; err: unknown; logs: string[] }

export interface SocketHandlers { open(): void; message(frame: string): void; alive(): void; close(code: number, httpStatus: number | null): void }
export interface StreamSocket { send(frame: string): void; ping(): void; terminate(): void }
export interface StreamDeps {
  endpoints: ChainEndpoints;
  open(url: string, on: SocketHandlers): StreamSocket;
  rpc<T>(method: string, params: unknown[]): Promise<T>;
  store: { get<T>(k: string): Promise<T | null>; set(k: string, v: unknown, ttlSec?: number): Promise<void> };
  /** Run `fn` after `ms`. */
  later(fn: () => void, ms: number): void;
  /** Milliseconds. */
  now(): number;
}

/** Reconnect delay: one second, doubling to a minute, plus up to a quarter of jitter so restarts do not line up. */
export function backoffMs(attempt: number, rand = Math.random()): number {
  return Math.round(Math.min(60_000, 1000 * 2 ** Math.min(Math.max(attempt, 0), 6)) * (1 + 0.25 * rand));
}

export const subscribeFrame = (program = PANTA_PROGRAM_MAINNET) =>
  JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'logsSubscribe', params: [{ mentions: [program] }, { commitment: 'confirmed' }] });

/** A logsNotification frame as an event; null for anything else (the subscribe answer, noise). */
export function parseLogEvent(frame: string): LogEvent | null {
  try {
    const j = JSON.parse(frame) as { method?: string; params?: { result?: { context?: { slot?: number }; value?: { signature?: string; err?: unknown; logs?: string[] } } } };
    const v = j.params?.result?.value;
    if (j.method !== 'logsNotification' || !v?.signature || !Array.isArray(v.logs)) return null;
    return { signature: v.signature, slot: Number(j.params?.result?.context?.slot ?? 0), err: v.err ?? null, logs: v.logs };
  } catch { return null; }
}

const hasOrder = (logs: string[] | undefined) => !!logs?.some((l) => parseOrderLog(l));

/** The account named by the event the program emits right after an order line: eight bytes of discriminator, then the market's key. */
function eventMarket(logs: string[]): string | null {
  const at = logs.findIndex((l) => parseOrderLog(l));
  const data = at < 0 ? undefined : logs.slice(at + 1).find((l) => l.startsWith('Program data: '));
  if (!data) return null;
  const raw = Buffer.from(data.slice('Program data: '.length), 'base64');
  return raw.length >= 40 ? bs58.encode(raw.subarray(8, 40)) : null;
}

/**
 * Which market a transaction's prints belong to. The market account is one of the transaction's accounts: the
 * one the radar's registry knows. A market created since the last scan is not in the registry yet, so the key
 * in the program's own event is taken instead, but only when it is also one of the transaction's accounts.
 */
export function marketOf(tx: Tx, known: Set<string>): string | null {
  const keys = [
    ...tx.transaction.message.accountKeys.map((k) => (typeof k === 'string' ? k : k.pubkey)),
    ...(tx.meta?.loadedAddresses?.writable ?? []), ...(tx.meta?.loadedAddresses?.readonly ?? []),
  ];
  const hits = keys.filter((k) => known.has(k));
  if (hits.length === 1) return hits[0];
  const named = eventMarket(tx.meta?.logMessages ?? []);
  return named && keys.includes(named) && (hits.length === 0 || hits.includes(named)) ? named : null;
}

/** Never let a key in a URL reach the health output or a log line. */
const safe = (msg: string) => msg.replace(/api_key=[^&\s"']+/g, 'api_key=***').slice(0, 200);
const secs = (ms: number | null) => (ms === null ? null : Math.round(ms / 1000));

export class TapeStream {
  private sock: StreamSocket | null = null;
  private gen = 0;
  private attempt = 0;
  private started = false;
  private stopped = false;
  private subscribed = false;
  private since = 0;
  private cursor: Cursor | null = null;
  private cursorDirty = false;
  private handled = new Set<string>();
  private known: { at: number; ids: Set<string> } | null = null;
  /** Prints are stored one after another, so two appends to the same tape never overwrite each other. */
  private queue: Promise<void> = Promise.resolve();
  private h = {
    provider: 'public' as StreamHealth['provider'], host: '', fallback: false,
    startedAt: null as number | null, connectedAt: null as number | null, lastAliveAt: null as number | null, lastEventAt: null as number | null,
    lastPrintAt: null as number | null, lastSlot: null as number | null, events: 0, prints: 0, recovered: 0, unmapped: 0, reconnects: 0, note: null as string | null,
  };

  constructor(private d: StreamDeps) {}

  start() {
    if (this.started) return;
    this.started = true; this.h.startedAt = this.d.now();
    this.connect();
  }

  stop() { this.stopped = true; this.sock?.terminate(); }

  /** Resolves when every frame received so far has been handled. */
  idle(): Promise<void> { return this.queue; }

  health(): StreamHealth {
    const h = this.h;
    return {
      enabled: true, connected: this.subscribed, provider: h.provider, host: h.host, fallback: h.fallback,
      startedAt: secs(h.startedAt), connectedAt: secs(h.connectedAt), lastAliveAt: secs(h.lastAliveAt), lastEventAt: secs(h.lastEventAt),
      lastSlot: h.lastSlot, lastPrintAt: secs(h.lastPrintAt), events: h.events, prints: h.prints, recovered: h.recovered, unmapped: h.unmapped,
      reconnects: h.reconnects, note: h.note,
    };
  }

  /** Keepalive, every KEEPALIVE_MS: ping the node, drop a socket that went silent, and save the cursor if it moved. */
  tick() {
    const now = this.d.now();
    if (this.sock) {
      if (now - Math.max(this.since, this.h.lastAliveAt ?? 0) > DEAD_AFTER_MS) this.sock.terminate();
      else if (this.subscribed) this.sock.ping();
    }
    if (this.cursorDirty && this.cursor) { this.cursorDirty = false; this.d.store.set(CURSOR_KEY, this.cursor).catch(() => { this.cursorDirty = true; }); }
  }

  private connect() {
    if (this.stopped) return;
    const ep = pickEndpoint('ws', this.d.endpoints, this.d.now());
    const gen = ++this.gen; // frames from a socket that was replaced are ignored
    this.h.provider = ep.provider; this.h.host = hostOf(ep.url); this.h.fallback = !!this.d.endpoints.fallback && ep.provider !== 'solami';
    this.since = this.d.now();
    const on: SocketHandlers = {
      open: () => { if (gen === this.gen) this.sock?.send(subscribeFrame()); },
      message: (frame) => { if (gen === this.gen) this.onFrame(frame); },
      alive: () => { if (gen === this.gen) this.h.lastAliveAt = this.d.now(); },
      close: (code, status) => { if (gen === this.gen) this.onClose(ep.provider, code, status); },
    };
    try { this.sock = this.d.open(ep.url, on); }
    catch (e) { this.h.note = safe((e as Error).message); this.onClose(ep.provider, 1006, null); }
  }

  private onFrame(frame: string) {
    this.h.lastAliveAt = this.d.now();
    const ev = parseLogEvent(frame);
    if (ev) return this.onEvent(ev);
    let ack: { id?: number; result?: unknown; error?: { message?: string } };
    try { ack = JSON.parse(frame); } catch { return; }
    if (ack.id !== 1) return;
    if (ack.error) { this.h.note = safe(`subscribe refused: ${ack.error.message ?? 'unknown error'}`); this.sock?.terminate(); return; }
    this.subscribed = true; this.h.connectedAt = this.d.now();
    if (!this.h.fallback) this.h.note = null; // on the fallback, the note keeps saying why
    // subscribed first, then read back what was missed: a print that lands in between is seen twice and stored once
    this.enqueue(() => this.catchUp());
  }

  private onEvent(ev: LogEvent) {
    this.h.events++; this.h.lastEventAt = this.d.now();
    if (ev.slot) this.h.lastSlot = Math.max(this.h.lastSlot ?? 0, ev.slot);
    this.enqueue(async () => {
      if (!ev.err && hasOrder(ev.logs)) await this.ingest(ev.signature, true);
      this.advance({ signature: ev.signature, slot: ev.slot });
    });
  }

  private onClose(provider: StreamHealth['provider'], code: number, status: number | null) {
    const now = this.d.now();
    const wasUp = this.subscribed;
    this.subscribed = false; this.sock = null;
    if (provider === 'solami' && ((status !== null && isRefusal('ws', status)) || REFUSAL_CLOSE_CODES.includes(code))) {
      markRefused('ws', now);
      this.h.note = `Solami refused the stream (${status !== null ? `HTTP ${status}` : `close ${code}`}); using the fallback endpoint`;
    } else if (!wasUp && status !== null) this.h.note = `connect failed: HTTP ${status}`;
    if (this.stopped) return;
    if (wasUp && now - (this.h.connectedAt ?? now) >= STABLE_AFTER_MS) this.attempt = 0;
    this.h.reconnects++;
    this.d.later(() => this.connect(), backoffMs(this.attempt++));
  }

  private enqueue(job: () => Promise<void>) {
    this.queue = this.queue.then(job).catch((e) => { this.h.note = safe((e as Error).message); });
  }

  private advance(c: Cursor) {
    if (this.cursor && c.slot < this.cursor.slot) return;
    this.cursor = c; this.cursorDirty = true;
    if (c.slot) this.h.lastSlot = Math.max(this.h.lastSlot ?? 0, c.slot);
  }

  private async knownIds(): Promise<Set<string>> {
    const now = this.d.now();
    if (!this.known || now - this.known.at > 60_000) this.known = { at: now, ids: new Set((await this.d.store.get<string[]>(KNOWN_IDS_KEY)) ?? []) };
    return this.known.ids;
  }

  /** Decode one transaction's prints and append them to its market's stored chain tape. */
  private async ingest(signature: string, live: boolean) {
    if (this.handled.has(signature)) return;
    let tx: Tx | null = null;
    // the node that pushed the log can be a moment ahead of the one that answers the fetch: a live print gets two more tries
    for (let i = 0; !tx && i < (live ? TX_TRIES : 1); i++) {
      if (i) await new Promise<void>((r) => this.d.later(r, 1500 * i));
      tx = await this.d.rpc<Tx | null>('getTransaction', [signature, { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]);
    }
    if (!tx || !hasOrder(tx.meta?.logMessages)) { if (!tx && live) this.h.note = `transaction ${signature.slice(0, 8)} not served yet; the next scan reads it`; return; }
    const marketId = marketOf(tx, await this.knownIds());
    if (!marketId) { this.h.unmapped++; return; }
    const prints = tradesFromTx(marketId, signature, tx);
    if (!prints.length) return;
    const key = CHAIN_TAPE_KEY(marketId);
    const cache = await this.d.store.get<ChainTapeCache>(key);
    const next = appendPrints(cache, prints);
    if (next !== cache) await this.d.store.set(key, next, 7 * 86400);
    this.handled.add(signature);
    if (this.handled.size > 500) this.handled.delete(this.handled.values().next().value as string);
    if (live) this.h.prints += prints.length; else this.h.recovered += prints.length;
    this.h.lastPrintAt = this.d.now();
  }

  /** Close the gap since the last signature handled: one bounded signature list, then one getTransaction per new signature. */
  private async catchUp() {
    try {
      this.cursor ??= await this.d.store.get<Cursor>(CURSOR_KEY);
      const rows = await this.d.rpc<SigRow[]>('getSignaturesForAddress', [PANTA_PROGRAM_MAINNET, { commitment: 'confirmed', ...(this.cursor ? { limit: CATCHUP_MAX, until: this.cursor.signature } : { limit: 1 }) }]);
      // the first run has no cursor and nothing to catch up on: history is the scan's job, the stream starts from now
      if (this.cursor) for (const r of [...rows].reverse()) if (!r.err) await this.ingest(r.signature, false);
      if (rows[0]) this.advance({ signature: rows[0].signature, slot: rows[0].slot });
    } catch (e) { this.h.note = safe(`catch-up failed: ${(e as Error).message}; the next scan covers the gap`); }
  }
}

export function openSocket(url: string, on: SocketHandlers): StreamSocket {
  const ws = new WebSocket(url, { handshakeTimeout: 20_000 });
  let status: number | null = null;
  ws.on('open', on.open);
  ws.on('message', (data) => on.message(data.toString()));
  ws.on('pong', on.alive);
  // a refused upgrade arrives as an error carrying the HTTP status, then a close
  ws.on('error', (e) => { const m = /Unexpected server response: (\d+)/.exec(e.message); if (m) status = Number(m[1]); });
  ws.on('close', (code) => on.close(code, status));
  return {
    send: (frame) => { if (ws.readyState === WebSocket.OPEN) ws.send(frame); },
    ping: () => { if (ws.readyState === WebSocket.OPEN) ws.ping(); },
    terminate: () => ws.terminate(),
  };
}

const OFF: StreamHealth = {
  enabled: false, connected: false, provider: 'public', host: '', fallback: false, startedAt: null, connectedAt: null, lastAliveAt: null,
  lastEventAt: null, lastSlot: null, lastPrintAt: null, events: 0, prints: 0, recovered: 0, unmapped: 0, reconnects: 0, note: null,
};

/** A long-lived socket needs a long-lived process: on by default, off on serverless hosts and during the build. SONAR_TAPE_STREAM=on|off overrides. */
export function streamEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.SONAR_TAPE_STREAM === 'off') return false;
  if (env.SONAR_TAPE_STREAM === 'on') return true;
  return !env.VERCEL && env.NEXT_PHASE !== 'phase-production-build';
}

// One stream per process, kept on globalThis so every route bundle (and a dev hot reload) shares it.
const SLOT = Symbol.for('sonar.tape-stream');
type Holder = { [SLOT]?: TapeStream };

/** Start the stream if this process has not yet, and report its state. Cheap to call on every request. */
export function ensureTapeStream(): StreamHealth {
  if (!streamEnabled()) return OFF;
  const g = globalThis as Holder;
  if (!g[SLOT]) {
    const s = new TapeStream({
      endpoints: chainEndpoints(), open: openSocket, rpc: chainRpc, store: store(), now: () => Date.now(),
      later: (fn, ms) => { setTimeout(fn, ms).unref(); },
    });
    g[SLOT] = s;
    s.start();
    setInterval(() => s.tick(), KEEPALIVE_MS).unref();
  }
  return g[SLOT].health();
}

const NAMES = { solami: 'Solami', custom: 'custom RPC', public: 'public' } as const;

/** Both paths in words, for example "RPC: Solami, stream: public fallback". */
export function pathsLine(rpc: ChainHealth['rpc'], stream: StreamHealth): string {
  const streamPath = !stream.enabled ? 'off' : `${NAMES[stream.provider]}${stream.fallback ? ' fallback' : ''}${stream.connected ? '' : ' (reconnecting)'}`;
  return `RPC: ${NAMES[rpc.provider]}${rpc.fallback ? ' fallback' : ''}, stream: ${streamPath}`;
}

/** Both chain paths as the health API and the market page report them. Starts the stream on first use. */
export function chainHealth(): ChainHealth {
  const ep = chainEndpoints();
  const http = pickEndpoint('http', ep);
  const rpc = { provider: http.provider, host: hostOf(http.url), fallback: !!ep.fallback && http.provider !== 'solami' };
  const stream = ensureTapeStream();
  return { rpc, stream, paths: pathsLine(rpc, stream) };
}
