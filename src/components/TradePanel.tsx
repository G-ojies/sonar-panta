'use client';
import { useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import type { BuyBuild, BuyQuote, MarketDetail, SignalSet } from '@/lib/types';
import { broadcast, compile, explorerTx } from '@/lib/solana';
import { cents, usd } from '@/lib/format';
import { postJson } from './useApi';
import { WalletButton } from './WalletButton';
import { useSandbox } from './useSandbox';

/** Read-only address used when sandbox mode is on and no wallet is connected: Panta's fixtures accept any pubkey and nothing is signed. */
const DEMO_WALLET = 'FHj8ZbHfcbYNhsLU7MyeckpR1a4ZQz8c5F1jyaBdr513';

type Step = 'idle' | 'quoting' | 'quoted' | 'building' | 'signing' | 'broadcasting' | 'submitting' | 'done' | 'error';

export function TradePanel({ market, yesPrice, tradable, lean, onDone }: { market: MarketDetail; yesPrice: number | null; tradable: boolean; lean: SignalSet['side']; onDone?: () => void }) {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const [sandbox] = useSandbox();
  const [side, setSide] = useState<'yes' | 'no'>(lean === 'NO' ? 'no' : 'yes');
  const [amount, setAmount] = useState('5');
  const [slip, setSlip] = useState(150);
  const [step, setStep] = useState<Step>('idle');
  const [quote, setQuote] = useState<BuyQuote | null>(null);
  const [sig, setSig] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);

  const busy = !['idle', 'quoted', 'done', 'error'].includes(step);
  const wallet = publicKey?.toBase58() ?? (sandbox ? DEMO_WALLET : undefined);
  const px = yesPrice === null ? null : side === 'yes' ? yesPrice : 1 - yesPrice;

  async function getQuote() {
    if (!wallet) return;
    setErr(null); setStep('quoting'); setQuote(null);
    try {
      const q = await postJson<BuyQuote>('/api/trade/quote', { wallet, marketId: market.marketId, side, amountUsdc: amount, sandbox });
      setQuote(q); setStep('quoted');
    } catch (e) { setErr((e as Error).message); setStep('error'); }
  }

  async function execute() {
    if (!wallet || !quote) return;
    if (!sandbox && (!publicKey || !signTransaction)) return;
    setErr(null);
    try {
      setStep('building');
      const b = await postJson<BuyBuild>('/api/trade/build', { wallet, quoteId: quote.quoteId, maxSlippageBps: slip, sandbox });
      let signature: string;
      if (sandbox || b.instructions.length === 0) {
        // Sandbox fixtures carry no instructions: nothing to sign or broadcast. Panta accepts a placeholder signature.
        signature = `sandbox${Date.now()}`;
      } else {
        setStep('signing');
        const tx = compile(publicKey!, b.instructions, b.recentBlockhash);
        const signed = await signTransaction!(tx);
        setStep('broadcasting');
        signature = await broadcast(connection, signed, b.lastValidBlockHeight);
      }
      setStep('submitting');
      const r = await postJson<{ submit?: { signature?: string }; verify?: { status?: string } }>('/api/trade/submit', { orderId: b.orderId, signature, sandbox });
      setSig(sandbox ? r.submit?.signature ?? signature : signature);
      try { await postJson('/api/trade/report', { signature, kind: 'buy', wallet, sandbox }); setReport('attributed'); }
      catch (e) { setReport(`report failed: ${(e as Error).message}`); }
      setStep('done'); onDone?.();
    } catch (e) {
      const m = (e as Error).message ?? String(e);
      if (/reject|cancel|denied/i.test(m)) { setStep('quoted'); return; } // user cancelled: not an error
      setErr(m); setStep('error');
    }
  }

  return (
    <section className="card p-5" aria-labelledby="trade-h">
      <div className="flex items-center justify-between">
        <h2 id="trade-h" className="font-medium">Trade</h2>
        <span className={`text-[11px] uppercase tracking-wide ${sandbox ? 'text-amber' : 'text-fog-2'}`}>{sandbox ? 'sandbox · no funds needed' : 'non-custodial · mainnet USDC'}</span>
      </div>

      {!tradable && !sandbox ? (
        <p className="mt-3 text-sm text-fog">
          {market.phase === 'resolved' ? 'This market has resolved. Claim winning shares from Portfolio.' :
           market.onChain?.isGraduated ? 'Buying has closed here. The market moved to Panta\'s secondary phase, which the public API does not expose yet.' :
           'Not taking buys right now.'}
        </p>
      ) : (
        <form className="mt-3 space-y-3" onSubmit={(e) => { e.preventDefault(); if (step === 'quoted') execute(); else getQuote(); }}>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Side">
            {(['yes', 'no'] as const).map((s) => (
              <button type="button" key={s} role="radio" aria-checked={side === s} onClick={() => { setSide(s); setQuote(null); setStep('idle'); }}
                className={`btn ${side === s ? (s === 'yes' ? 'btn-yes' : 'btn-no') : ''}`}>
                {s.toUpperCase()} <span className="mono text-xs opacity-80">{cents(s === 'yes' ? yesPrice : yesPrice === null ? null : 1 - yesPrice)}</span>
              </button>
            ))}
          </div>
          <div>
            <label htmlFor="amt" className="label">Amount (USDC)</label>
            <input id="amt" className="field mono" type="number" inputMode="decimal" min="0.5" step="0.5" value={amount} onChange={(e) => { setAmount(e.target.value); setQuote(null); setStep('idle'); }} required />
          </div>
          <div>
            <label htmlFor="slip" className="label">Max slippage: {(slip / 100).toFixed(2)}%</label>
            <input id="slip" type="range" min={25} max={1000} step={25} value={slip} onChange={(e) => setSlip(Number(e.target.value))} className="w-full accent-ping" />
          </div>
          {lean !== 'FLAT' && <p className="text-xs text-fog-2">Sonar leans <span className={lean === 'YES' ? 'text-yes' : 'text-no'}>{lean}</span> on this market. That is a signal, not advice.</p>}

          {quote && (
            <dl className="mono grid grid-cols-2 gap-y-1 rounded-md border border-line bg-ink p-3 text-xs">
              <dt className="text-fog-2">you pay</dt><dd className="text-right">{usd(quote.amountUsdc)}</dd>
              <dt className="text-fog-2">you receive</dt><dd className="text-right text-paper">{Number(quote.shares).toFixed(2)} {side.toUpperCase()} shares</dd>
              <dt className="text-fog-2">avg price</dt><dd className="text-right">{quote.avgPrice ? cents(Number(quote.avgPrice)) : cents(px)}</dd>
              <dt className="text-fog-2">protocol fee</dt><dd className="text-right">{usd(quote.feeUsdc)}</dd>
              <dt className="text-fog-2">if {side.toUpperCase()} wins</dt><dd className="text-right text-yes">{usd(Number(quote.shares))}</dd>
              <dt className="text-fog-2">quote expires</dt><dd className="text-right">{new Date(quote.expiresAt).toLocaleTimeString()}</dd>
            </dl>
          )}

          {!wallet ? <WalletButton /> : (<>
            {!publicKey && sandbox && <p className="text-xs text-amber">No wallet connected. The sandbox uses a read-only demo address.</p>}
            <button type="submit" disabled={busy} className={`btn w-full ${step === 'quoted' ? 'btn-primary' : ''}`}>
              {step === 'idle' || step === 'error' ? 'Get a quote' : step === 'quoting' ? 'Quoting…' : step === 'quoted' ? `Sign & buy ${side.toUpperCase()}` :
               step === 'building' ? 'Building transaction…' : step === 'signing' ? 'Approve in wallet…' : step === 'broadcasting' ? 'Broadcasting…' : step === 'submitting' ? 'Confirming with Panta…' : 'Done'}
            </button>
          </>)}
          {step === 'quoted' && <p className="text-xs text-fog-2">Panta builds the instructions; your wallet signs; we broadcast on our RPC and file the signature back for attribution.</p>}
        </form>
      )}

      {err && (
        <div role="alert" className="mt-3 rounded-md border border-no/40 bg-no/10 p-3 text-xs text-no">
          {friendly(err)}
          <div className="mt-2"><button className="btn h-8" onClick={() => { setErr(null); setStep(quote ? 'quoted' : 'idle'); }}>Try again</button></div>
        </div>
      )}
      {sig && (
        <div role="status" className="mt-3 rounded-md border border-yes/40 bg-yes/10 p-3 text-xs text-paper">
          <div>{sandbox ? <>Filled in the sandbox. Panta returned signature <span className="mono">{sig.slice(0, 12)}…</span>; no transaction was sent.</> : <>Filled. <a href={explorerTx(sig)} target="_blank" rel="noopener noreferrer">View transaction ↗</a></>}</div>
          {report && <div className="mt-1 text-fog">{report === 'attributed' ? 'Trade reported to Panta (attributed to Sonar).' : report}</div>}
        </div>
      )}
    </section>
  );
}

function friendly(m: string): string {
  if (/QUOTE_STALE/.test(m)) return 'The curve moved more than your slippage allows. Re-quote or raise slippage.';
  if (/QUOTE_EXPIRED/.test(m)) return 'Quote expired (they last about 90s). Get a fresh quote.';
  if (/AMOUNT_TOO_SMALL/.test(m)) return 'Amount is below the minimum fill for this market.';
  if (/MARKET_NOT_IN_PRIMARY/.test(m)) return 'This market is no longer in its primary buy window.';
  if (/insufficient|0x1\b|Attempt to debit/i.test(m)) return 'Insufficient USDC or SOL for fees in this wallet.';
  if (/Blockhash not found|block height exceeded/i.test(m)) return 'The transaction expired before it landed. Re-quote and try again.';
  return m;
}
