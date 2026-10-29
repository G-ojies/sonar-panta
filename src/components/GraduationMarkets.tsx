'use client';
import { useEffect, useMemo, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import type { GradMarketView, GradPayload } from '@/lib/grad-market-server';
import { ago, dateShort, short } from '@/lib/format';
import { useApi } from './useApi';
import { WalletButton } from './WalletButton';

/**
 * The pm-AMM graduation markets page: every market grad_resolver holds on devnet, its YES price, the pool's progress
 * toward graduation, and what a trader signs (buy, sell, claim, open a market). The wallet only signs: transactions go
 * to devnet through their own connection whatever cluster the rest of the app is on, so this works on the mainnet
 * site too. web3.js and the builders load when a wallet acts.
 */

const DEC = 6;
const explorer = (kind: 'tx' | 'account', v: string) => `https://solscan.io/${kind}/${v}?cluster=devnet`;
const fmt = (raw: string | bigint | number, d = 2) => (Number(raw) / 10 ** DEC).toLocaleString('en-GB', { maximumFractionDigits: d });
const cents = (p: number | null) => (p === null ? '--' : `${Math.round(p * 100)}¢`);
const toRaw = (s: string) => BigInt(Math.round((Number(s) || 0) * 10 ** DEC));

type Step = 'idle' | 'building' | 'signing' | 'broadcasting';
const PHASE: Record<GradMarketView['phase'], { label: string; tone: string }> = {
  trading: { label: 'trading', tone: 'bg-ping/15 text-ping' },
  known: { label: 'outcome known · halt due', tone: 'bg-amber/15 text-amber' },
  halted: { label: 'outcome known · halted', tone: 'bg-amber/15 text-amber' },
  expired: { label: 'deadline passed', tone: 'bg-amber/15 text-amber' },
  'resolved-yes': { label: 'resolved YES', tone: 'bg-yes/15 text-yes' },
  'resolved-no': { label: 'resolved NO', tone: 'bg-no/15 text-no' },
};
const PRESETS = [{ label: '1 h', secs: 3600 }, { label: '6 h', secs: 6 * 3600 }, { label: '24 h', secs: 86400 }, { label: '3 d', secs: 3 * 86400 }];

export function GraduationMarkets({ initial }: { initial: GradPayload | null }) {
  const { publicKey, signTransaction } = useWallet();
  const wallet = publicKey?.toBase58();
  const url = `/api/graduation${wallet ? `?user=${wallet}` : ''}`;
  const { data, reload } = useApi<GradPayload>(url, [wallet], 15_000);
  const payload = data ?? initial;
  const markets = useMemo(() => payload?.markets ?? [], [payload]);
  const user = payload?.user ?? null;

  const [selected, setSelected] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('idle');
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ sig: string; what: string } | null>(null);
  const [faucet, setFaucet] = useState<'idle' | 'asking' | 'ok' | string>('idle');
  // null until mounted: times and countdowns depend on the browser's clock and time zone, so they are left out of
  // the server render (otherwise React reports a hydration mismatch).
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => { setNow(Date.now() / 1000); const t = setInterval(() => setNow(Date.now() / 1000), 10_000); return () => clearInterval(t); }, []);

  const current = markets.find((m) => m.binding.address === selected) ?? markets[0] ?? null;
  const busy = step !== 'idle';

  /** Build, sign with the wallet, and send to devnet. */
  async function send(what: string, build: (lib: typeof import('@/lib/grad-market')) => Promise<import('@solana/web3.js').TransactionInstruction[]>) {
    if (!publicKey || !signTransaction) return;
    setErr(null); setDone(null);
    try {
      setStep('building');
      const [lib, w3, sol] = await Promise.all([import('@/lib/grad-market'), import('@solana/web3.js'), import('@/lib/solana')]);
      const conn = new w3.Connection(lib.GRAD_RPC, 'confirmed');
      const ixs = await build(lib);
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
      const tx = new w3.VersionedTransaction(new w3.TransactionMessage({ payerKey: publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
      setStep('signing');
      const signed = await signTransaction(tx);
      setStep('broadcasting');
      const sig = await sol.broadcast(conn, signed, lastValidBlockHeight);
      setDone({ sig, what });
      await fetch(`${url}${wallet ? '&' : '?'}fresh=1`, { cache: 'no-store' }).catch(() => undefined);
      await reload();
    } catch (e) {
      const m = (e as Error).message ?? String(e);
      if (!/reject|cancel|denied/i.test(m)) {
        const { friendlyGradError } = await import('@/lib/grad-market');
        setErr(friendlyGradError(m));
      }
    } finally { setStep('idle'); }
  }

  async function askFaucet() {
    if (!wallet) return;
    setFaucet('asking');
    const res = await fetch('/api/graduation/faucet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wallet }) }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { ok?: boolean; message?: string; error?: string } | undefined;
    setFaucet(res?.ok && j?.ok !== false ? 'ok' : (j?.message ?? j?.error ?? 'The faucet refused; it allows one request per wallet now and then.'));
    setTimeout(() => reload(), 4000);
  }

  return (
    <div className="space-y-5">
      <section className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="text-sm">
          {!wallet ? <span className="text-fog">Connect a wallet set to <strong className="text-paper">devnet</strong> to trade. Nothing here has real value.</span> : (
            <span className="text-fog">Wallet <span className="mono text-paper">{short(wallet, 4)}</span> · <span className="mono text-paper">{fmt(user?.musdcRaw ?? '0')}</span> mUSDC on devnet</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!wallet ? <WalletButton /> : (
            <button type="button" className="btn h-9" onClick={askFaucet} disabled={faucet === 'asking'}>
              {faucet === 'asking' ? 'Asking the faucet…' : 'Get 1,000 test mUSDC'}
            </button>
          )}
        </div>
        {faucet !== 'idle' && faucet !== 'asking' && (
          <p className={`w-full text-xs ${faucet === 'ok' ? 'text-yes' : 'text-amber'}`}>{faucet === 'ok' ? 'Sent. The balance updates in a few seconds.' : faucet}</p>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-label="Markets" className="space-y-3">
          {markets.length === 0 ? (
            <p className="card p-5 text-sm text-fog-2">{payload ? 'No graduation market yet. Open the first one.' : 'Reading markets…'}</p>
          ) : markets.map((m) => (
            <MarketCard key={m.binding.address} m={m} now={now} selected={current?.binding.address === m.binding.address} holding={user?.holdings[m.binding.address] ?? null} onSelect={() => setSelected(m.binding.address)} />
          ))}
        </section>

        <aside className="space-y-4">
          {current && <TradeBox key={current.binding.address} m={current} wallet={wallet ?? null} holding={user?.holdings[current.binding.address] ?? null} busy={busy} step={step}
            onSwap={(direction, amountRaw) => send(`${direction.startsWith('buy') ? 'Bought' : 'Sold'} ${direction.endsWith('Yes') ? 'YES' : 'NO'}`, async (lib) => lib.swapPlan(publicKey!, current.binding.address, current.pm!, direction, amountRaw))}
            onClaim={() => send('Winnings claimed', async (lib) => lib.claimPlan(publicKey!, current.binding.address, current.pm!))}
            onCrank={(s) => send(CRANK[s].done, async (lib) => lib.crankPlan(s, publicKey!, current.binding, current.pm!))}
          />}
          <OpenMarket wallet={wallet ?? null} busy={busy} step={step} now={now ?? Date.now() / 1000}
            onOpen={(pool, deadline, seedRaw) => send('Market opened', async (lib) => {
              const [w3, dbc] = await Promise.all([import('@solana/web3.js'), import('@/lib/dbc')]);
              const acc = await new w3.Connection(lib.GRAD_RPC, 'confirmed').getAccountInfo(new w3.PublicKey(pool));
              if (!acc) throw new Error('No account at that address on devnet.');
              const config = dbc.decodePool(Buffer.from(acc.data)).config;
              return lib.openMarketPlan(publicKey!, { address: pool, config }, deadline, seedRaw).instructions;
            })}
          />
          {err && (
            <div role="alert" className="rounded-md border border-no/40 bg-no/10 p-3 text-xs text-no">
              {err}<div className="mt-2"><button className="btn h-8" onClick={() => setErr(null)}>Dismiss</button></div>
            </div>
          )}
          {done && (
            <div role="status" className="rounded-md border border-yes/40 bg-yes/10 p-3 text-xs text-paper">
              {done.what}. <a href={explorer('tx', done.sig)} target="_blank" rel="noopener noreferrer">View transaction ↗</a>
            </div>
          )}
        </aside>
      </div>

      <p className="text-[11px] leading-relaxed text-fog-2">
        Program <a className="mono" href={explorer('account', payload?.program ?? '73G7X9FKEgTtNQMBWGsCGZfHHBpvVxsJ9kqvV6mvubJH')} target="_blank" rel="noopener noreferrer">{short(payload?.program ?? '73G7X9FKEgTtNQMBWGsCGZfHHBpvVxsJ9kqvV6mvubJH', 5)}</a> on devnet, priced by pm-AMM.
        Each market&apos;s pm-AMM authority is a program address, so no key picks the winner: once the pool shows the outcome anyone can halt trading, and after the deadline anyone can resolve it from the pool account.
        JSON at <code className="mono">/api/graduation</code>.
      </p>
    </div>
  );
}

const clock = (ts: number) => `${dateShort(ts)} ${new Date(ts * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;

function MarketCard({ m, now, selected, holding, onSelect }: { m: GradMarketView; now: number | null; selected: boolean; holding: { yesRaw: string; noRaw: string } | null; onSelect: () => void }) {
  const left = now === null ? null : m.binding.deadlineTs - now;
  const phase = PHASE[m.phase];
  return (
    <button type="button" onClick={onSelect} aria-pressed={selected} className={`card w-full p-4 text-left transition-colors ${selected ? '!border-ping/50' : 'hover:!border-fog-2'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-paper">Pool <span className="mono">{short(m.binding.pool, 5)}</span> graduates by {now === null ? 'the deadline' : clock(m.binding.deadlineTs)}?</span>
        <span className={`chip ${phase.tone}`}>{phase.label}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="price-tile price-yes !py-2"><span>Yes</span><strong>{cents(m.yesPrice)}</strong></div>
        <div className="price-tile price-no !py-2"><span>No</span><strong>{cents(m.yesPrice === null ? null : 1 - m.yesPrice)}</strong></div>
      </div>
      {m.pool && (
        <div className="mt-3">
          <div className="flex justify-between text-[11px] text-fog-2"><span>Curve progress</span><span className="mono">{(m.pool.progress * 100).toFixed(1)}%{m.pool.complete ? ' · graduated' : ''}</span></div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-3"><div className={`h-full ${m.pool.complete ? 'bg-yes' : 'bg-ping'}`} style={{ width: `${Math.max(2, m.pool.progress * 100)}%` }} /></div>
        </div>
      )}
      <div className="mono mt-2 flex flex-wrap gap-x-3 text-[11px] text-fog-2">
        <span>{fmt(m.vaultRaw, 0)} mUSDC in the vault</span>
        {left !== null && <span>{m.phase === 'trading' ? `${ago(left)} left` : left > 0 ? `deadline in ${ago(left)}` : `deadline ${ago(-left)} ago`}</span>}
        {holding && <span className="text-paper">you: {fmt(holding.yesRaw)} YES · {fmt(holding.noRaw)} NO</span>}
      </div>
    </button>
  );
}

const DIRS = [
  { key: 'buyYes', label: 'Buy YES', tone: 'btn-yes' }, { key: 'buyNo', label: 'Buy NO', tone: 'btn-no' },
  { key: 'sellYes', label: 'Sell YES', tone: 'btn-yes' }, { key: 'sellNo', label: 'Sell NO', tone: 'btn-no' },
] as const;

/** The permissionless steps, as the page offers them to any visitor. */
const CRANK: Record<NonNullable<GradMarketView['due']>, { button: string; why: string; done: string }> = {
  halt: { button: 'Sign & halt trading', why: 'The outcome is known. Halting pulls the liquidity so nobody can trade on it.', done: 'Trading halted' },
  resolve: { button: 'Sign & resolve from the pool', why: 'The deadline has passed. Resolving reads the winner from the pool account.', done: 'Market resolved' },
  settle: { button: 'Sign & settle to the opener', why: 'Settling returns the pulled liquidity and the fees to whoever opened the market.', done: 'Market settled' },
};

function TradeBox({ m, wallet, holding, busy, step, onSwap, onClaim, onCrank }: {
  m: GradMarketView; wallet: string | null; holding: { yesRaw: string; noRaw: string } | null; busy: boolean; step: Step;
  onSwap: (direction: (typeof DIRS)[number]['key'], amountRaw: bigint) => void; onClaim: () => void;
  onCrank: (s: NonNullable<GradMarketView['due']>) => void;
}) {
  const [dir, setDir] = useState<(typeof DIRS)[number]['key']>('buyYes');
  const [amount, setAmount] = useState('10');
  const label = step === 'building' ? 'Building transaction…' : step === 'signing' ? 'Approve in wallet…' : step === 'broadcasting' ? 'Broadcasting…' : null;
  const won = m.phase === 'resolved-yes' ? holding?.yesRaw : m.phase === 'resolved-no' ? holding?.noRaw : undefined;
  const price = dir.endsWith('Yes') ? m.yesPrice : m.yesPrice === null ? null : 1 - m.yesPrice;
  const buying = dir.startsWith('buy');
  return (
    <section className="card p-5" aria-labelledby="trade-h">
      <h2 id="trade-h" className="font-medium">Trade</h2>
      {m.phase === 'trading' ? (
        <form className="mt-3 space-y-3" onSubmit={(e) => { e.preventDefault(); onSwap(dir, toRaw(amount)); }}>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Order">
            {DIRS.map((d) => <button type="button" key={d.key} role="radio" aria-checked={dir === d.key} onClick={() => setDir(d.key)} className={`btn h-9 ${dir === d.key ? d.tone : ''}`}>{d.label}</button>)}
          </div>
          <div>
            <label htmlFor="amt" className="label">{buying ? 'Spend (mUSDC)' : `Sell (${dir.endsWith('Yes') ? 'YES' : 'NO'} tokens)`}</label>
            <input id="amt" className="field mono" type="number" inputMode="decimal" min="0.001" step="0.001" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </div>
          <p className="text-[11px] text-fog-2">
            {price !== null ? <>Price now {cents(price)}. </> : null}
            {buying ? 'A winning token pays 1 mUSDC. pm-AMM takes 2% of the mUSDC leg; half goes to the market.' : 'Selling returns mUSDC at the current curve price, less the 2% fee.'}
          </p>
          {!wallet ? <WalletButton /> : <button type="submit" disabled={busy || toRaw(amount) <= 0n} className="btn btn-primary h-10 w-full">{label ?? `Sign & ${DIRS.find((d) => d.key === dir)!.label.toLowerCase()}`}</button>}
        </form>
      ) : m.phase === 'known' || m.phase === 'halted' || m.phase === 'expired' ? (
        <p className="mt-2 text-sm text-fog">
          {m.phase === 'known' ? 'The curve has finished, so the answer is already on chain. Trading is closed here until the market is halted. '
            : m.phase === 'halted' ? 'The outcome is known, so the liquidity was pulled and trading stopped. ' : 'The deadline has passed. '}
          After the deadline the market resolves from the pool account; then winning tokens can be claimed here for 1 mUSDC each.
        </p>
      ) : (
        <div className="mt-2 space-y-2 text-sm">
          <p className="text-fog">Resolved <strong className={m.phase === 'resolved-yes' ? 'text-yes' : 'text-no'}>{m.phase === 'resolved-yes' ? 'YES' : 'NO'}</strong> from the pool account.</p>
          {won && won !== '0' ? (
            !wallet ? <WalletButton /> : <button type="button" className="btn btn-primary h-10 w-full" disabled={busy} onClick={onClaim}>{label ?? `Sign & claim ${fmt(won)} mUSDC`}</button>
          ) : <p className="text-xs text-fog-2">{wallet ? 'This wallet holds no winning tokens here.' : 'Connect a wallet to see if you have winnings.'}</p>}
        </div>
      )}
      {holding && <p className="mono mt-3 text-[11px] text-fog-2">You hold {fmt(holding.yesRaw)} YES · {fmt(holding.noRaw)} NO</p>}
      {m.due && (
        <div className="mt-3 rounded-md border border-line bg-ink p-3 text-xs">
          <p className="text-fog">{CRANK[m.due].why} Anyone can do this; it costs only the network fee{m.due === 'halt' ? ' and about 0.004 devnet SOL of rent' : ''}.</p>
          {!wallet ? <div className="mt-2"><WalletButton /></div> : <button type="button" className="btn mt-2 h-9 w-full" disabled={busy} onClick={() => onCrank(m.due!)}>{label ?? CRANK[m.due].button}</button>}
        </div>
      )}
    </section>
  );
}

function OpenMarket({ wallet, busy, step, now, onOpen }: { wallet: string | null; busy: boolean; step: Step; now: number; onOpen: (pool: string, deadline: number, seedRaw: bigint) => void }) {
  const [open, setOpen] = useState(false);
  const [pool, setPool] = useState('');
  const [secs, setSecs] = useState(86400);
  const [seed, setSeed] = useState('100');
  const ok = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(pool.trim()) && Number(seed) >= 1;
  const deadline = Math.floor(now) + secs;
  if (!open) return <button type="button" className="btn h-9 w-full" onClick={() => setOpen(true)}>Open a market on a pool</button>;
  return (
    <section className="card p-5" aria-labelledby="open-h">
      <h2 id="open-h" className="font-medium">Open a market</h2>
      <form className="mt-3 space-y-3" onSubmit={(e) => { e.preventDefault(); if (ok) onOpen(pool.trim(), deadline, toRaw(seed)); }}>
        <div>
          <label htmlFor="pool" className="label">DBC pool address (devnet)</label>
          <input id="pool" className="field mono text-xs" value={pool} onChange={(e) => setPool(e.target.value)} placeholder="a VirtualPool still on its curve" required />
        </div>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Deadline">
          {PRESETS.map((p) => <button type="button" key={p.secs} role="radio" aria-checked={secs === p.secs} onClick={() => setSecs(p.secs)} className={`chip border px-2.5 py-1 ${secs === p.secs ? 'border-ping/50 bg-ping/15 text-ping' : 'border-line text-fog hover:text-paper'}`}>{p.label}</button>)}
        </div>
        <div>
          <label htmlFor="seed" className="label">Liquidity to seed (mUSDC)</label>
          <input id="seed" className="field mono" type="number" min="1" step="1" value={seed} onChange={(e) => setSeed(e.target.value)} />
        </div>
        <p className="text-[11px] text-fog-2">
          Opens at 50¢ and resolves YES if the curve fills by {clock(deadline)}.
          You seed the liquidity and earn the market&apos;s half of the fee; after resolution the keeper returns what is left to you. Costs about 0.07 devnet SOL of rent.
        </p>
        <div className="flex gap-2">
          <button type="button" className="btn h-9" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
          {!wallet ? <WalletButton /> : <button type="submit" className="btn btn-primary h-9 flex-1" disabled={busy || !ok}>{step === 'building' ? 'Building…' : step === 'signing' ? 'Approve in wallet…' : step === 'broadcasting' ? 'Broadcasting…' : 'Sign & open'}</button>}
        </div>
      </form>
    </section>
  );
}
