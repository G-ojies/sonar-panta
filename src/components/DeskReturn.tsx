'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { postJson } from './useApi';

/** PayPal sends the buyer back here (?token=<order id>) after approving an order the agent opened: capture it and show the brief. */
interface Res { brief: { marketId: string; title: string; status: string; outcome?: string; demo?: boolean; call: { side: string; score: number } }; text: { headline: string; body: string[]; risks: string[] } | null }

export function DeskReturn() {
  const q = useSearchParams();
  const order = q.get('token');
  const cancelled = q.get('cancelled') === '1';
  const [res, setRes] = useState<Res | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const once = useRef(false);

  useEffect(() => {
    if (!order || cancelled || once.current) return;
    once.current = true;
    postJson<Res>('/api/pay/capture', { orderId: order }).then(setRes).catch((e) => setErr((e as Error).message));
  }, [order, cancelled]);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <nav className="text-xs text-fog-2"><Link href="/desk">Sonar Desk</Link> / payment</nav>
      <section className="card space-y-3 p-6 text-sm">
        {!order && <p className="text-no">No PayPal order in this link.</p>}
        {cancelled && <p className="text-fog">You cancelled in PayPal, so nothing was charged. The agent&rsquo;s order expires on its own.</p>}
        {order && !cancelled && !res && !err && <p className="text-fog">Confirming your payment with PayPal…</p>}
        {err && <p className="text-no">{err}</p>}
        {res && (
          <>
            {res.brief.status === 'paid' && <p className="text-xs text-ping">Paid · guarantee open: refunded through PayPal if this market resolves against {res.brief.call.side}.</p>}
            {res.brief.status === 'kept' && <p className="text-xs text-yes">Call was right ({res.brief.outcome}).</p>}
            {res.brief.status === 'refunded' && <p className="text-xs text-amber">{res.brief.demo ? `Sandbox demo: simulated outcome ${res.brief.outcome}, so the call was wrong; refunded to your PayPal.` : `Call was wrong (${res.brief.outcome}); refunded to your PayPal.`}</p>}
            <h1 className="text-lg font-semibold">{res.text?.headline ?? res.brief.title}</h1>
            <ul className="space-y-1.5 text-fog">{res.text?.body.map((b, i) => <li key={i}>{b}</li>)}</ul>
            <div className="border-t border-line pt-2 text-xs text-fog-2">{res.text?.risks.map((r, i) => <p key={i}>{r}</p>)}</div>
            <div className="flex gap-2 pt-1">
              <Link className="btn btn-primary" href="/desk">Back to the agent</Link>
              <Link className="btn" href={`/market/${res.brief.marketId}`}>Open the market</Link>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
