'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { setPro } from './pro';

/** PayPal returns here (?subscription_id=I-...) after the buyer approves Sonar Pro. Activation can lag a few seconds, so poll. */
export function DeskPro() {
  const q = useSearchParams();
  const id = q.get('subscription_id');
  const cancelled = q.get('cancelled') === '1';
  const [status, setStatus] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id || cancelled) return;
    let tries = 0; let stop = false;
    const check = async () => {
      try {
        const r = await fetch(`/api/pay/subscription?id=${encodeURIComponent(id)}&fresh=1`);
        const j = await r.json();
        if (!r.ok) throw new Error(j.message ?? j.error);
        setStatus(j.status);
        if (j.active) { setPro(id); return; }
      } catch (e) { setErr((e as Error).message); return; }
      if (!stop && ++tries < 10) setTimeout(check, 3000);
    };
    void check();
    return () => { stop = true; };
  }, [id, cancelled]);

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <nav className="text-xs text-fog-2"><Link href="/desk">Sonar Desk</Link> / Sonar Pro</nav>
      <section className="card space-y-3 p-6 text-sm">
        {!id && <p className="text-no">No PayPal subscription in this link.</p>}
        {cancelled && <p className="text-fog">You cancelled in PayPal, so nothing was charged.</p>}
        {id && !cancelled && status !== 'ACTIVE' && !err && <p className="text-fog">Confirming your subscription with PayPal{status ? ` (${status.toLowerCase().replace('_', ' ')})` : ''}…</p>}
        {err && <p className="text-no">{err}</p>}
        {status === 'ACTIVE' && (
          <>
            <h1 className="text-lg font-semibold">Sonar Pro is active.</h1>
            <p className="text-fog">Every brief on Sonar is now included: open any market and read its brief without checking out. Cancel any time from your PayPal account.</p>
            <div className="flex gap-2"><Link className="btn btn-primary" href="/">Go to the radar</Link><Link className="btn" href="/desk">Sonar Desk</Link></div>
          </>
        )}
      </section>
    </div>
  );
}
