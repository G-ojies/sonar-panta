/**
 * Key/value store with three backends, chosen at runtime:
 *  1. Upstash Redis (KV_REST_API_URL / KV_REST_API_TOKEN) — production on Vercel
 *  2. JSON file (SONAR_STORE_FILE) — local scripts / the agent
 *  3. In-memory — fallback
 */
import { Redis } from '@upstash/redis';
import nodeFs from 'fs';
import { gunzipSync, gzipSync } from 'zlib';

type Json = unknown;

interface Backend {
  get<T = Json>(k: string): Promise<T | null>;
  /** Many keys in one command (Upstash bills per command, so a scan reads its per-market keys this way). */
  mget<T = Json>(keys: string[]): Promise<(T | null)[]>;
  set(k: string, v: Json, ttlSec?: number): Promise<void>;
  del(k: string): Promise<void>;
  lpush(k: string, v: Json, cap?: number): Promise<void>;
  lrange<T = Json>(k: string, start: number, stop: number): Promise<T[]>;
}

// Upstash's free plan caps bandwidth at 10 GB a month, and the radar alone is about 1 MB of JSON.
// Large values travel gzipped (as a "gz:" base64 string, roughly a fifth of the size); small ones and
// anything written before this stay plain JSON and read as before.
const GZ = 'gz:';
const GZ_MIN = 16_000;
export function pack(v: Json): Json {
  const s = JSON.stringify(v);
  return s && s.length > GZ_MIN ? GZ + gzipSync(s).toString('base64') : v;
}
export function unpack<T>(v: unknown): T {
  return (typeof v === 'string' && v.startsWith(GZ) ? JSON.parse(gunzipSync(Buffer.from(v.slice(GZ.length), 'base64')).toString('utf8')) : v) as T;
}

function redisBackend(): Backend | null {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const r = new Redis({ url, token });
  return {
    async get(k) { return unpack(await r.get(k)); },
    async mget(keys) {
      const out: unknown[] = [];
      for (let i = 0; i < keys.length; i += 200) out.push(...(await r.mget(...keys.slice(i, i + 200))));
      return out.map((v) => unpack(v)) as never;
    },
    async set(k, v, ttl) { const p = pack(v); if (ttl) await r.set(k, p, { ex: ttl }); else await r.set(k, p); },
    async del(k) { await r.del(k); },
    async lpush(k, v, cap) { await r.lpush(k, v); if (cap) await r.ltrim(k, 0, cap - 1); },
    async lrange(k, a, b) { return (await r.lrange(k, a, b)) as never; },
  };
}

function memoryBackend(file?: string): Backend {
  type Cell = { v: Json; exp?: number };
  let kv: Record<string, Cell> = {};
  let lists: Record<string, Json[]> = {};
  const fs = file ? nodeFs : null;
  if (fs && file && fs.existsSync(file)) {
    try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); kv = j.kv ?? {}; lists = j.lists ?? {}; } catch { /* corrupt file: start fresh */ }
  }
  let timer: NodeJS.Timeout | null = null;
  let lastMtime = 0;
  const persist = () => {
    if (!fs || !file) return;
    if (timer) return;
    timer = setTimeout(() => { timer = null; fs.writeFileSync(file, JSON.stringify({ kv, lists })); try { lastMtime = fs.statSync(file).mtimeMs; } catch { /* ignore */ } }, 200);
  };
  // Several processes (dev server, agent script) may share the file: reload when another writer touched it.
  const sync = () => {
    if (!fs || !file) return;
    try {
      const m = fs.statSync(file).mtimeMs;
      if (m !== lastMtime && !timer) { const j = JSON.parse(fs.readFileSync(file, 'utf8')); kv = j.kv ?? {}; lists = j.lists ?? {}; lastMtime = m; }
    } catch { /* missing or mid-write: keep memory copy */ }
  };
  return {
    async mget(keys) { return Promise.all(keys.map((k) => this.get(k))) as never; },
    async get(k) { sync(); const c = kv[k]; if (!c) return null; if (c.exp && c.exp < Date.now()) { delete kv[k]; return null; } return c.v as never; },
    // reload before every write so a process with a stale copy never overwrites another writer's data
    async set(k, v, ttl) { sync(); kv[k] = { v, exp: ttl ? Date.now() + ttl * 1000 : undefined }; persist(); },
    async del(k) { sync(); delete kv[k]; persist(); },
    async lpush(k, v, cap) { sync(); const l = (lists[k] ??= []); l.unshift(v); if (cap && l.length > cap) l.length = cap; persist(); },
    async lrange(k, a, b) { sync(); const l = lists[k] ?? []; return l.slice(a, b === -1 ? undefined : b + 1) as never; },
  };
}

let backend: Backend | null = null;
export function store(): Backend {
  if (backend) return backend;
  backend = redisBackend() ?? memoryBackend(process.env.SONAR_STORE_FILE);
  if (process.env.SONAR_STORE_STATS) backend = counted(backend);
  return backend;
}

// SONAR_STORE_STATS=1 prints how many commands and bytes a run cost, for sizing against the Upstash quota.
function counted(b: Backend): Backend {
  const n: Record<string, number> = {}; let bytes = 0;
  const size = (v: unknown) => (v == null ? 0 : JSON.stringify(v).length);
  const hit = (op: string, k: string) => { const key = `${op} ${k.split(':').slice(0, 2).join(':')}`; n[key] = (n[key] ?? 0) + 1; };
  process.on('exit', () => {
    const total = Object.values(n).reduce((a, x) => a + x, 0);
    console.error(`store: ${total} commands, ${(bytes / 1e6).toFixed(2)} MB`);
    for (const [k, x] of Object.entries(n).sort((a, z) => z[1] - a[1])) console.error(`  ${String(x).padStart(5)} ${k}`);
  });
  return {
    async get(k) { hit('get', k); const v = await b.get(k); bytes += size(v); return v as never; },
    async mget(keys) { if (keys.length) hit('mget', keys[0]); const v = await b.mget(keys); bytes += size(v); return v as never; },
    async set(k, v, ttl) { hit('set', k); bytes += size(v); return b.set(k, v, ttl); },
    async del(k) { hit('del', k); return b.del(k); },
    async lpush(k, v, cap) { hit('lpush', k); bytes += size(v); return b.lpush(k, v, cap); },
    async lrange(k, a, z) { hit('lrange', k); const v = await b.lrange(k, a, z); bytes += size(v); return v as never; },
  };
}
export const storeKind = () => (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL ? 'redis' : process.env.SONAR_STORE_FILE ? 'file' : 'memory');
