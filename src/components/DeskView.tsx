'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Masthead, Strip } from './Desk';
import { postJson, useApi } from './useApi';
import { getPro, setPro } from './pro';

/** Sonar Desk: the shopping agent, the purchases waiting for PayPal approval, and the guarantee's public record. */

interface Approval { briefId: string; marketId: string; title: string; side: string; approveUrl: string | null; orderId: string }
interface Step { tool: string; args: unknown; result: unknown }
interface Reply { text: string; steps: Step[]; approvals: Approval[]; spentCents: number; budgetCents: number }
interface Msg { role: 'user' | 'assistant'; content: string; steps?: Step[] }
interface Ledger {
  stats: { sold: number; open: number; right: number; refunded: number; missed?: number; refundedCents: number; keptCents: number; hitRate: number | null };
  settled: Array<{ id: string; marketId: string; title: string; side: string; outcome?: string; status: string; via: string }>;
}

const CATS = ['crypto', 'sports', 'politics', 'finance', 'entertainment', 'world'];
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const TOOL_LABEL: Record<string, string> = { find_calls: 'searched Sonar', buy_brief: 'opened a PayPal order', check_purchases: 'checked purchases', read_brief: 'read a brief', paypal_get_order: 'asked PayPal about an order' };

function sessionId(): string {
  try {
    const k = 'sonar:desk:session';
    const v = localStorage.getItem(k);
    if (v) return v;
    const n = crypto.randomUUID();
    localStorage.setItem(k, n);
    return n;
  } catch { return crypto.randomUUID(); }
}

export function DeskView() {
  const [session, setSession] = useState('');
  const [budget, setBudget] = useState(6);
  const [cats, setCats] = useState<string[]>(['crypto']);
  const [minScore, setMinScore] = useState(20);
  const [input, setInput] = useState('Find the two strongest crypto calls and buy their briefs.');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [spent, setSpent] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { data: ledger } = useApi<Ledger>('/api/desk/ledger', [], 60_000);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => { setSession(sessionId()); }, []);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [msgs]);

  async function send() {
    const text = input.trim();
    if (!text || !session || busy) return;
    const next: Msg[] = [...msgs, { role: 'user', content: text }];
    setMsgs(next); setInput(''); setBusy(true); setErr(null);
    try {
      const r = await postJson<Reply>('/api/desk/agent', {
        session, messages: next.map(({ role, content }) => ({ role, content })),
        mandate: { maxCents: Math.round(budget * 100), categories: cats, minScore, minHoursLeft: 6 },
      });
      setMsgs([...next, { role: 'assistant', content: r.text || '(no reply)', steps: r.steps }]);
      setApprovals((a) => [...r.approvals, ...a]);
      setSpent(r.spentCents);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  const s = ledger?.stats;
  return (
    <div className="space-y-6">
      <Masthead
        kicker="Sonar Desk · PayPal sandbox"
        title="An agent that buys signals for you, and refunds the wrong ones."
        note={<>Tell the agent what you want. It searches Sonar&rsquo;s radar, opens a PayPal order for each $1.99 brief that fits your mandate, and waits: nothing is paid until you approve it in PayPal. When a market resolves against a brief&rsquo;s call, the money goes back to your PayPal automatically.</>}
        aside={s ? <Strip items={[
          { k: 'Briefs sold', v: s.sold },
          { k: 'Right', v: s.right, tone: 'yes' },
          { k: 'Refunded', v: `${s.refunded} · ${money(s.refundedCents)}`, tone: 'amber' },
          { k: 'Hit rate', v: s.hitRate === null ? '—' : `${Math.round(s.hitRate * 100)}%` },
        ]} /> : undefined}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="card flex min-h-[420px] flex-col p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold">Shopping agent</h2>
          <div className="mt-3 flex-1 space-y-3 overflow-y-auto text-sm">
            {!msgs.length && <p className="text-fog">Try: “Buy briefs on any sports call above 40, at most two.” or “What did my briefs say?”</p>}
            {msgs.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'ml-auto max-w-[85%] rounded-xl bg-ink-3 px-3 py-2' : 'max-w-[95%]'}>
                {m.steps && m.steps.length > 0 && (
                  <ul className="mb-1.5 space-y-0.5 text-[11px] text-fog-2">
                    {m.steps.map((st, j) => <li key={j} className="mono">→ {TOOL_LABEL[st.tool] ?? st.tool}{refusal(st)}</li>)}
                  </ul>
                )}
                <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
              </div>
            ))}
            {busy && <p className="text-xs text-fog">Agent is working…</p>}
            <div ref={end} />
          </div>
          {err && <p className="mt-2 text-xs text-no">{err}</p>}
          <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); void send(); }}>
            <input className="h-10 flex-1 rounded-xl border border-line bg-ink-3 px-3 text-sm text-paper outline-none focus:border-fog-2" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask the agent…" maxLength={500} />
            <button className="btn btn-primary" disabled={busy || !input.trim()}>Send</button>
          </form>
        </section>

        <aside className="space-y-4">
          <section className="card space-y-3 p-5 text-sm">
            <h2 className="font-semibold">Mandate</h2>
            <label className="block text-xs text-fog">Budget this session: <span className="mono text-paper">{money(budget * 100)}</span> <span className="text-fog-2">(committed {money(spent)})</span>
              <input type="range" min={2} max={20} step={1} value={budget} onChange={(e) => setBudget(Number(e.target.value))} className="mt-1 w-full" />
            </label>
            <label className="block text-xs text-fog">Least call strength: <span className="mono text-paper">{minScore}</span>
              <input type="range" min={0} max={80} step={5} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} className="mt-1 w-full" />
            </label>
            <div className="flex flex-wrap gap-1.5">
              {CATS.map((c) => (
                <button key={c} type="button" onClick={() => setCats((x) => (x.includes(c) ? x.filter((y) => y !== c) : [...x, c]))} className={`chip cursor-pointer ${cats.includes(c) ? 'bg-ping/20 text-ping' : 'bg-ink-3 text-fog-2'}`}>{c}</button>
              ))}
            </div>
            <p className="text-[11px] text-fog-2">The limits are checked by Sonar&rsquo;s server on every purchase, not by the model.</p>
          </section>

          <section className="card space-y-2 p-5 text-sm">
            <h2 className="font-semibold">Waiting for your approval</h2>
            {!approvals.length && <p className="text-xs text-fog">Orders the agent opens appear here. Approve each one in PayPal.</p>}
            {approvals.map((a) => (
              <div key={a.briefId} className="rounded-xl border border-line p-3">
                <p className="text-xs"><span className={a.side === 'YES' ? 'text-yes' : 'text-no'}>{a.side}</span> · {a.title}</p>
                <div className="mt-2 flex gap-2">
                  {a.approveUrl && <a className="btn btn-primary h-8 flex-1 text-xs" href={a.approveUrl}>Approve $1.99 in PayPal</a>}
                  <Link className="btn h-8 text-xs" href={`/market/${a.marketId}`}>Market</Link>
                </div>
              </div>
            ))}
          </section>

          <ProCard />

          {ledger && ledger.settled.length > 0 && (
            <section className="card space-y-1.5 p-5 text-xs">
              <h2 className="text-sm font-semibold">Guarantee record</h2>
              {ledger.settled.slice(0, 8).map((b) => (
                <p key={b.id} className="text-fog"><span className={b.status === 'kept' ? 'text-yes' : 'text-amber'}>{b.status === 'kept' ? 'right' : b.status === 'missed' ? 'missed (Pro)' : 'refunded'}</span> · called {b.side}, resolved {b.outcome} · {b.title}</p>
              ))}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

function refusal(st: Step) {
  const r = st.result as { refused?: string } | null;
  return r && typeof r === 'object' && r.refused ? ` (refused: ${r.refused})` : '';
}

/** Sonar Pro: $7.99 a month through PayPal Subscriptions, every brief included. */
function ProCard() {
  const [sub, setSub] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const id = getPro(); setSub(id);
    if (!id) return;
    fetch(`/api/pay/subscription?id=${encodeURIComponent(id)}`).then((r) => r.json()).then((j) => { setStatus(j.status ?? null); if (j.active === false && j.status && j.status !== 'APPROVED') { setPro(null); setSub(null); } }).catch(() => {});
  }, []);
  async function start() {
    setBusy(true); setErr(null);
    try { const r = await postJson<{ approveUrl: string | null }>('/api/pay/subscribe', {}); if (r.approveUrl) window.location.href = r.approveUrl; else throw new Error('PayPal did not return an approval link'); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  }
  return (
    <section id="pro" className="card space-y-2 p-5 text-sm">
      <div className="flex items-baseline justify-between"><h2 className="font-semibold">Sonar Pro</h2><span className="mono text-xs text-fog">$7.99 / month</span></div>
      {sub && status === 'ACTIVE'
        ? <p className="text-xs text-ping">Active. Every brief is included; manage or cancel it in your PayPal account.</p>
        : <>
            <p className="text-xs text-fog">Every brief on every market, no checkout per brief. Billed monthly by PayPal; cancel any time.</p>
            <button className="btn btn-primary w-full" disabled={busy} onClick={() => void start()}>Subscribe with PayPal</button>
          </>}
      {err && <p className="text-xs text-no">{err}</p>}
    </section>
  );
}
