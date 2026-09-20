'use client';
import { useCallback, useEffect, useState } from 'react';

export function useApi<T>(url: string | null, deps: unknown[] = [], intervalMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!url);
  const load = useCallback(async () => {
    if (!url) return;
    try {
      const r = await fetch(url, { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message || j.error || `HTTP ${r.status}`);
      setData(j); setError(null);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [url]);
  useEffect(() => { setLoading(!!url); load(); }, [load, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!intervalMs || !url) return; const t = setInterval(load, intervalMs); return () => clearInterval(t); }, [load, intervalMs, url]);
  return { data, error, loading, reload: load };
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message ? `${j.error}: ${j.message}` : j.error || `HTTP ${r.status}`);
  return j as T;
}
