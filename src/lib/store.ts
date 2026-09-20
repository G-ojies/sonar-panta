/**
 * Key/value store with three backends, chosen at runtime:
 *  1. Upstash Redis (KV_REST_API_URL / KV_REST_API_TOKEN) — production on Vercel
 *  2. JSON file (SONAR_STORE_FILE) — local scripts / the agent
 *  3. In-memory — fallback
 */
import { Redis } from '@upstash/redis';
import nodeFs from 'fs';

type Json = unknown;

interface Backend {
  get<T = Json>(k: string): Promise<T | null>;
  set(k: string, v: Json, ttlSec?: number): Promise<void>;
  del(k: string): Promise<void>;
  lpush(k: string, v: Json, cap?: number): Promise<void>;
  lrange<T = Json>(k: string, start: number, stop: number): Promise<T[]>;
}

function redisBackend(): Backend | null {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const r = new Redis({ url, token });
  return {
    async get(k) { return (await r.get(k)) as never; },
    async set(k, v, ttl) { if (ttl) await r.set(k, v, { ex: ttl }); else await r.set(k, v); },
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
    async get(k) { sync(); const c = kv[k]; if (!c) return null; if (c.exp && c.exp < Date.now()) { delete kv[k]; return null; } return c.v as never; },
    async set(k, v, ttl) { kv[k] = { v, exp: ttl ? Date.now() + ttl * 1000 : undefined }; persist(); },
    async del(k) { delete kv[k]; persist(); },
    async lpush(k, v, cap) { const l = (lists[k] ??= []); l.unshift(v); if (cap && l.length > cap) l.length = cap; persist(); },
    async lrange(k, a, b) { sync(); const l = lists[k] ?? []; return l.slice(a, b === -1 ? undefined : b + 1) as never; },
  };
}

let backend: Backend | null = null;
export function store(): Backend {
  if (backend) return backend;
  backend = redisBackend() ?? memoryBackend(process.env.SONAR_STORE_FILE);
  return backend;
}
export const storeKind = () => (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL ? 'redis' : process.env.SONAR_STORE_FILE ? 'file' : 'memory');
