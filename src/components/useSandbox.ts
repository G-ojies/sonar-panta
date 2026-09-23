'use client';
import { useCallback, useEffect, useState } from 'react';

const KEY = 'sonar:sandbox';
const EVT = 'sonar:sandbox-change';

function read(): boolean {
  try {
    const q = new URLSearchParams(window.location.search).get('sandbox');
    if (q === '1' || q === 'true') { localStorage.setItem(KEY, '1'); return true; }
    if (q === '0' || q === 'false') { localStorage.setItem(KEY, '0'); return false; }
    return localStorage.getItem(KEY) === '1';
  } catch { return false; }
}

/**
 * Sandbox mode routes every Panta write (quote, build, submit, claim, create) through the
 * pk_test_ key. Panta answers with fixtures and nothing touches Solana, so the whole flow
 * can be demonstrated with an empty wallet. Persisted per browser; `?sandbox=1` turns it on.
 */
export function useSandbox(): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState(false);
  useEffect(() => {
    setOn(read());
    const h = () => setOn(read());
    window.addEventListener(EVT, h); window.addEventListener('storage', h);
    return () => { window.removeEventListener(EVT, h); window.removeEventListener('storage', h); };
  }, []);
  const set = useCallback((v: boolean) => {
    try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* private mode */ }
    setOn(v); window.dispatchEvent(new Event(EVT));
  }, []);
  return [on, set];
}
