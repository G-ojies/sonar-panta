'use client';
import { useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import type { CreateBuild, CreateQuote } from '@/lib/types';
import type { Draft } from '@/lib/draft';
import { broadcast, deserialize, explorerTx } from '@/lib/solana';
import { marketUrl } from '@/lib/panta-public';
import { postJson } from './useApi';
import { WalletButton } from './WalletButton';
import { PoweredByPanta } from './PoweredByPanta';
import { Masthead } from './Desk';
import { useSandbox } from './useSandbox';

/** Read-only address used when sandbox mode is on and no wallet is connected: Panta's fixtures accept any pubkey and nothing is signed. */
const DEMO_WALLET = 'FHj8ZbHfcbYNhsLU7MyeckpR1a4ZQz8c5F1jyaBdr513';

const CATS = ['sports', 'crypto', 'politics', 'entertainment', 'finance', 'science', 'world', 'other'];

/**
 * Starting points for creators. Panta's catalog has no African markets yet; these are the
 * questions Nigerian traders already argue about every week. They are prompts, not final
 * markets: the drafter turns one into a question + resolution rule, and you edit before quoting.
 */
const STARTERS: { group: string; items: string[] }[] = [
  { group: 'Nigeria', items: [
    'CBN Monetary Policy Committee: will the MPR be held unchanged at the next meeting?',
    'NBS inflation report: will September 2026 headline inflation print below the August figure?',
    'Naira: will the official NFEM closing rate on 31 October 2026 be stronger than its 30 September close?',
    'NGX All-Share Index: will it close October 2026 above its September close?',
    'Super Eagles: will Nigeria win its next competitive fixture?',
    'PMS pump price: will NNPC or Dangote announce a petrol price cut before 31 October 2026?',
  ] },
  { group: 'Global', items: [
    'Will Bitcoin close above its 1 October 2026 open on 31 October 2026 (Coinbase daily close)?',
    'Will the Fed change the federal funds target range at its next FOMC meeting?',
    'Will Solana daily transactions exceed Ethereum L1 every day of October 2026?',
  ] },
];
const toLocal = (unix: number) => new Date(unix * 1000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const fromLocal = (s: string) => Math.floor(new Date(s).getTime() / 1000);

export function CreateFlow() {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const [sandbox] = useSandbox();
  const wallet = publicKey?.toBase58() ?? (sandbox ? DEMO_WALLET : undefined);
  const [input, setInput] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [imageUrl, setImageUrl] = useState('');
  const [quote, setQuote] = useState<CreateQuote | null>(null);
  const [step, setStep] = useState<'idle' | 'drafting' | 'quoting' | 'building' | 'signing' | 'broadcasting' | 'registering' | 'done'>('idle');
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ marketId: string; sig: string } | null>(null);
  const busy = !['idle', 'done'].includes(step);

  async function doDraft() {
    setErr(null); setStep('drafting'); setQuote(null);
    try { setDraft(await postJson<Draft>('/api/create/draft', { input })); } catch (e) { setErr((e as Error).message); }
    finally { setStep('idle'); }
  }
  const upd = (k: keyof Draft, v: unknown) => { setDraft((d) => (d ? { ...d, [k]: v } : d)); setQuote(null); };

  function body() {
    if (!draft || !wallet) return null;
    const now = Date.now() / 1000;
    return {
      wallet, question: draft.question, title: draft.title, description: draft.description, resolutionRule: draft.resolutionRule,
      sourcesOfTruth: draft.sourcesOfTruth, category: draft.category, startTime: Math.floor(now + 3700), endTime: draft.endTime,
      resolutionTime: Math.max(draft.resolutionTime, draft.endTime), imageUrl, marketType: draft.marketType, region: 'Global',
    };
  }

  async function doQuote() {
    setErr(null); setStep('quoting');
    try { setQuote(await postJson<CreateQuote>('/api/create/quote', { ...body(), sandbox })); } catch (e) { setErr((e as Error).message); }
    finally { setStep('idle'); }
  }

  async function doCreate() {
    if (!quote || !wallet) return;
    if (!sandbox && !signTransaction) return;
    setErr(null);
    try {
      setStep('building');
      const b = await postJson<CreateBuild>('/api/create/build', { createId: quote.createId, wallet, sandbox });
      let sig: string;
      if (sandbox || !b.transaction) {
        sig = `sandbox${Date.now()}`; // fixture build carries no transaction: nothing to sign
      } else {
        setStep('signing');
        const signed = await signTransaction!(deserialize(b.transaction));
        setStep('broadcasting');
        sig = await broadcast(connection, signed, b.lastValidBlockHeight);
      }
      setStep('registering');
      const r = await postJson<{ marketId: string }>('/api/create/register', { createId: quote.createId, signature: sig, sandbox });
      setResult({ marketId: r.marketId ?? quote.expectedEventPda, sig }); setStep('done');
    } catch (e) { const m = (e as Error).message; if (!/reject|cancel/i.test(m)) setErr(m); setStep('idle'); }
  }

  return (
    <div className="space-y-6">
      <Masthead kicker="Create" title="Turn a headline into a market Panta can resolve." note="Paste a headline, a question or a URL. Sonar drafts a YES/NO market with a rule that can actually be settled; you edit it, Panta quotes the fee, your wallet signs. Creators earn a share of every trade their market attracts." aside={<PoweredByPanta />} />

      <section className="card p-4">
        <label htmlFor="in" className="label">Headline, question or URL</label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input id="in" className="field" value={input} onChange={(e) => setInput(e.target.value)} placeholder="e.g. Will BTC close above $120k on 1 October?" />
          <button className="btn btn-primary shrink-0" disabled={busy || input.trim().length < 8} onClick={doDraft}>{step === 'drafting' ? 'Drafting…' : 'Draft market'}</button>
        </div>
        <div className="mt-4 space-y-2">
          {STARTERS.map((g) => (
            <div key={g.group} className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[11px] uppercase tracking-wide text-fog-2">{g.group}</span>
              {g.items.map((t) => (
                <button key={t} type="button" onClick={() => { setInput(t); setDraft(null); setQuote(null); }}
                  className="rounded-md border border-line px-2 py-1 text-left text-xs text-fog hover:border-fog-2 hover:text-paper" title={t}>
                  {t.split(':')[0].replace(/\?$/, '')}
                </button>
              ))}
            </div>
          ))}
          <p className="text-xs text-fog-2">Panta lists no African markets yet. Creators earn a share of every trade their market attracts, so the first Nigerian boards are open ground.</p>
        </div>
      </section>

      {draft && (
        <section className="card space-y-3 p-4">
          <div className="flex items-center justify-between"><h2 className="font-medium">Your draft</h2><span className="text-xs text-fog-2">via {draft.via}</span></div>
          {draft.rationale && <p className="text-xs text-fog">{draft.rationale}</p>}
          <Field label="Question" id="q"><input id="q" className="field" value={draft.question} onChange={(e) => upd('question', e.target.value)} maxLength={500} /></Field>
          <Field label="Title" id="t"><input id="t" className="field" value={draft.title} onChange={(e) => upd('title', e.target.value)} maxLength={80} /></Field>
          <Field label="Resolution rule" id="r"><textarea id="r" className="field h-24 py-2" value={draft.resolutionRule} onChange={(e) => upd('resolutionRule', e.target.value)} maxLength={2000} /></Field>
          <Field label="Sources of truth (one URL per line)" id="s"><textarea id="s" className="field mono h-20 py-2 text-xs" value={draft.sourcesOfTruth.join('\n')} onChange={(e) => upd('sourcesOfTruth', e.target.value.split('\n').map((x) => x.trim()).filter(Boolean))} /></Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Category" id="c"><select id="c" className="field" value={draft.category} onChange={(e) => upd('category', e.target.value)}>{CATS.map((c) => <option key={c}>{c}</option>)}</select></Field>
            <Field label="Trading ends" id="e"><input id="e" type="datetime-local" className="field" value={toLocal(draft.endTime)} onChange={(e) => upd('endTime', fromLocal(e.target.value))} /></Field>
            <Field label="Type" id="mt"><select id="mt" className="field" value={draft.marketType} onChange={(e) => upd('marketType', e.target.value)}><option value="standard">standard</option><option value="breaking">breaking (&lt;48h)</option></select></Field>
          </div>
          <Field label="Catalog image URL (public, 1024×1024)" id="img"><input id="img" className="field mono text-xs" value={imageUrl} onChange={(e) => { setImageUrl(e.target.value); setQuote(null); }} placeholder="https://…/image.png" /></Field>

          {quote && (
            <dl className="mono grid grid-cols-2 gap-y-1 rounded-md border border-line bg-ink p-3 text-xs">
              <dt className="text-fog-2">creation fee</dt><dd className="text-right text-paper">{(Number(quote.paymentUsdc) / 1e6).toFixed(2)} USDC</dd>
              <dt className="text-fog-2">seeds liquidity</dt><dd className="text-right">{(Number(quote.liquidityInjectionUsdc) / 1e6).toFixed(2)} USDC</dd>
              <dt className="text-fog-2">platform</dt><dd className="text-right">{(Number(quote.platformRevenueUsdc) / 1e6).toFixed(2)} USDC</dd>
              <dt className="text-fog-2">market address</dt><dd className="truncate text-right">{quote.expectedEventPda}</dd>
              <dt className="text-fog-2">session expires</dt><dd className="text-right">{new Date(quote.expiresAt).toLocaleTimeString()}</dd>
            </dl>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {!wallet ? <WalletButton /> : !quote ? (
              <button className="btn" disabled={busy || !imageUrl || !draft.sourcesOfTruth.length} onClick={doQuote}>{step === 'quoting' ? 'Quoting…' : 'Quote creation fee'}</button>
            ) : (
              <button className="btn btn-primary" disabled={busy} onClick={doCreate}>
                {step === 'building' ? 'Building…' : step === 'signing' ? 'Approve in wallet…' : step === 'broadcasting' ? 'Broadcasting…' : step === 'registering' ? 'Registering with Panta…' : `Sign & create (${(Number(quote.paymentUsdc) / 1e6).toFixed(0)} USDC)`}
              </button>
            )}
            <span className="text-xs text-fog-2">Trading opens about an hour after creation (on-chain minimum start delay).</span>
          </div>
          {err && <p role="alert" className="text-xs text-no">{err}</p>}
          {result && (sandbox ? <p role="status" className="text-sm">Registered in the sandbox as <span className="mono">{result.marketId}</span>. Panta fixtures only; no fee was paid and nothing was sent on chain.</p>
            : <p role="status" className="text-sm">Market created. <a href={marketUrl(result.marketId)} target="_blank" rel="noopener noreferrer">View on Panta ↗</a> · <a href={explorerTx(result.sig)} target="_blank" rel="noopener noreferrer">transaction ↗</a></p>)}
        </section>
      )}
    </div>
  );
}
function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return <div><label htmlFor={id} className="label">{label}</label>{children}</div>;
}
