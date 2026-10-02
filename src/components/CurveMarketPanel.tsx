'use client';
import { useEffect, useMemo, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import type { CurvePool } from '@/lib/curve';
import type { MarketAccount, PositionAccount } from '@/lib/curve-market';
import { decide, impliedOdds, positionPayout, resolvedState, sideMultiple, MIN_STAKE, type Side } from '@/lib/curve-market-math';
import type { MarketsPayload } from '@/lib/curve-market-server';
import { ago, dateShort, fmtQuote, short } from '@/lib/format';
import { useApi } from './useApi';
import { WalletButton } from './WalletButton';

/**
 * The graduation market panel on a pool page: the markets open on the pool, their odds, and the four actions the
 * curve_market program offers (open a market, stake YES or NO, resolve, claim). Reads come from /api/curve/markets;
 * the instruction builders and web3.js are loaded only when a wallet acts, so the page stays light.
 *
 * The program runs on devnet for now. When the app's own cluster is the markets' cluster the actions are enabled and
 * the connected wallet signs; otherwise the markets are shown read-only with a note.
 */

const CLUSTER = process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? 'mainnet-beta';
const suffix = CLUSTER === 'devnet' ? '?cluster=devnet' : '';
const explorerTx = (sig: string) => `https://solscan.io/tx/${sig}${suffix}`;
const explorerAccount = (a: string) => `https://solscan.io/account/${a}${suffix}`;

const PRESETS: { label: string; secs: number }[] = [{ label: '1 h', secs: 3600 }, { label: '6 h', secs: 6 * 3600 }, { label: '24 h', secs: 86400 }, { label: '7 d', secs: 7 * 86400 }];

type Step = 'idle' | 'building' | 'signing' | 'broadcasting' | 'done';
type Action = { kind: 'open'; deadline: number } | { kind: 'stake'; market: string; side: Side } | { kind: 'resolve'; market: string } | { kind: 'claim'; market: string };

export function CurveMarketPanel({ pool, initial }: { pool: CurvePool; initial: MarketsPayload | null }) {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const wallet = publicKey?.toBase58();
  const url = `/api/curve/markets?pool=${pool.address}${wallet ? `&user=${wallet}` : ''}`;
  const { data, reload } = useApi<MarketsPayload>(url, [wallet], 15_000);
  const payload = data ?? initial;
  const live = payload?.live ?? CLUSTER === 'devnet';
  const markets = useMemo(() => payload?.markets ?? [], [payload]);
  const positions = useMemo(() => new Map((payload?.positions ?? []).map((p) => [p.market, p])), [payload]);

  const [selected, setSelected] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [step, setStep] = useState<Step>('idle');
  const [acting, setActing] = useState<Action | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sig, setSig] = useState<{ sig: string; what: string } | null>(null);
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => { const t = setInterval(() => setNow(Date.now() / 1000), 10_000); return () => clearInterval(t); }, []);

  const current = markets.find((m) => m.address === selected) ?? markets[0] ?? null;
  const busy = step !== 'idle' && step !== 'done';
  const canAct = live && pool.status === 'trading';

  /** Build, sign and send one transaction with the wallet; the builders load on first use. */
  async function send(what: string, action: Action, build: (lib: typeof import('@/lib/curve-market')) => Promise<import('@solana/web3.js').TransactionInstruction[]>) {
    if (!publicKey || !signTransaction) return;
    setErr(null); setSig(null); setActing(action);
    try {
      setStep('building');
      const [lib, w3, sol] = await Promise.all([import('@/lib/curve-market'), import('@solana/web3.js'), import('@/lib/solana')]);
      const ixs = await build(lib);
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      const tx = new w3.VersionedTransaction(new w3.TransactionMessage({ payerKey: publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
      setStep('signing');
      const signed = await signTransaction(tx);
      setStep('broadcasting');
      const signature = await sol.broadcast(connection, signed, lastValidBlockHeight);
      setSig({ sig: signature, what });
      setStep('done');
      await fetch(`${url}&fresh=1`, { cache: 'no-store' }).catch(() => undefined);
      await reload();
    } catch (e) {
      const m = (e as Error).message ?? String(e);
      if (/reject|cancel|denied/i.test(m)) { setStep('idle'); return; } // the wallet said no: not an error
      const { friendlyProgramError } = await import('@/lib/curve-market');
      setErr(friendlyProgramError(m)); setStep('idle');
    } finally { setActing(null); }
  }

  const openMarket = (deadline: number) => send('Market opened', { kind: 'open', deadline }, async (lib) => {
    const quoteMintInfo = await connection.getAccountInfo(lib.pubkey(pool.quote.mint));
    const tokenProgram = quoteMintInfo?.owner.toBase58() ?? lib.TOKEN_PROGRAM;
    return [lib.createMarketIx(publicKey!, { pool: pool.address, config: pool.config, quoteMint: pool.quote.mint, tokenProgram }, deadline).ix];
  });

  const stake = (m: MarketAccount, side: Side, amountRaw: bigint) => send(`Staked ${side.toUpperCase()}`, { kind: 'stake', market: m.address, side }, async (lib) => {
    const ata = lib.associatedTokenAddress(publicKey!, m.quoteMint, m.tokenProgram);
    const info = await connection.getAccountInfo(ata);
    if (!lib.isNativeMint(m.quoteMint)) {
      const held = info ? lib.tokenAccountAmount(info.data) : 0n;
      if (held < amountRaw) throw new Error(`This wallet holds ${fmtQuote(Number(held) / 10 ** pool.quote.decimals, pool.quote.symbol)}, less than the stake.`);
    }
    return lib.stakePlan(publicKey!, m, side, amountRaw, !!info);
  });

  const resolve = (m: MarketAccount) => send('Market resolved', { kind: 'resolve', market: m.address }, async (lib) => [lib.resolveIx(m)]);

  const claim = (m: MarketAccount) => send('Claimed', { kind: 'claim', market: m.address }, async (lib) => {
    const ata = lib.associatedTokenAddress(publicKey!, m.quoteMint, m.tokenProgram);
    const info = await connection.getAccountInfo(ata);
    return lib.claimPlan(publicKey!, m, !!info);
  });

  return (
    <section className="card p-5" aria-labelledby="gm-h">
      <div className="flex items-center justify-between gap-2">
        <h2 id="gm-h" className="font-medium">Graduation market</h2>
        <span className={`pill ${live ? 'pill-amber' : ''}`} title={live ? 'The curve_market program runs on devnet. Stakes are devnet SOL.' : 'Markets are read from devnet; this app is on mainnet, so they are shown read-only.'}>
          {live ? 'devnet' : 'devnet · read-only'}
        </span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-fog">
        Will this curve graduate before a date? Stake {pool.quote.symbol} on YES or NO; when the market resolves the losing side pays the winning side pro rata. Resolution reads this pool account alone, no oracle.
      </p>
      {!live && (
        <p className="mt-2 rounded-md border border-amber/30 bg-amber/10 p-2 text-[11px] leading-relaxed text-amber">
          The program is deployed on devnet only, so markets are read-only here. Run the app with <span className="mono">NEXT_PUBLIC_SOLANA_CLUSTER=devnet</span> to open one, stake, resolve and claim.
        </p>
      )}

      {markets.length === 0 ? (
        <p className="mt-3 text-sm text-fog-2">{payload ? 'No market on this pool yet.' : 'Reading markets…'}</p>
      ) : (
        <ul className="mt-3 space-y-2" aria-label="Markets on this pool">
          {markets.map((m) => (
            <MarketRow key={m.address} m={m} pool={pool} now={now} selected={current?.address === m.address} position={positions.get(m.address) ?? null} onSelect={() => setSelected(m.address)} />
          ))}
        </ul>
      )}

      {current && (
        <MarketActions
          m={current} pool={pool} now={now} live={live} wallet={wallet ?? null} position={positions.get(current.address) ?? null}
          busy={busy} step={step} acting={acting}
          onStake={(side, amt) => stake(current, side, amt)} onResolve={() => resolve(current)} onClaim={() => claim(current)}
        />
      )}

      {live && (
        <div className="mt-4 border-t border-line pt-3">
          {!opening ? (
            <button type="button" className="btn h-9 w-full" onClick={() => setOpening(true)} disabled={!canAct} title={!canAct ? 'A market can only be opened on a curve that is still trading' : undefined}>
              Open a market
            </button>
          ) : (
            <OpenForm pool={pool} now={now} wallet={wallet ?? null} busy={busy} step={acting?.kind === 'open' ? step : 'idle'} onSubmit={openMarket} onCancel={() => setOpening(false)} />
          )}
        </div>
      )}

      {err && (
        <div role="alert" className="mt-3 rounded-md border border-no/40 bg-no/10 p-3 text-xs text-no">
          {err}
          <div className="mt-2"><button className="btn h-8" onClick={() => setErr(null)}>Dismiss</button></div>
        </div>
      )}
      {sig && (
        <div role="status" className="mt-3 rounded-md border border-yes/40 bg-yes/10 p-3 text-xs text-paper">
          {sig.what}. <a href={explorerTx(sig.sig)} target="_blank" rel="noopener noreferrer">View transaction ↗</a>
        </div>
      )}
      <p className="mt-3 text-[11px] leading-relaxed text-fog-2">
        Program <a href={explorerAccount(payload?.program ?? 'DPsFa2nxH568WZdeAgmdaxBrS3Je4UK4K7axxzCYAqjp')} target="_blank" rel="noopener noreferrer" className="mono">{short(payload?.program ?? 'DPsFa2nxH568WZdeAgmdaxBrS3Je4UK4K7axxzCYAqjp', 5)}</a> on devnet. No fee, no admin key. Smallest stake 0.001 SOL or 1 USDC. JSON at <code className="mono">/api/curve/markets?pool=…</code>.
      </p>
    </section>
  );
}

const STATE_LABEL: Record<MarketAccount['state'], string> = { open: 'open', yes: 'resolved YES', no: 'resolved NO', refund: 'refund' };
const STATE_TONE: Record<MarketAccount['state'], string> = { open: 'bg-ping/15 text-ping', yes: 'bg-yes/15 text-yes', no: 'bg-no/15 text-no', refund: 'bg-amber/15 text-amber' };

function MarketRow({ m, pool, now, selected, position, onSelect }: { m: MarketAccount; pool: CurvePool; now: number; selected: boolean; position: PositionAccount | null; onSelect: () => void }) {
  const d = pool.quote.decimals;
  const yes = Number(m.yesTotalRaw) / 10 ** d, no = Number(m.noTotalRaw) / 10 ** d;
  const odds = impliedOdds(m);
  const left = m.deadlineTs - now;
  return (
    <li>
      <button type="button" onClick={onSelect} aria-pressed={selected} className={`w-full rounded-xl border p-3 text-left transition-colors ${selected ? 'border-ping/50 bg-ping/5' : 'border-line hover:border-fog-2'}`}>
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-paper">graduates by {dateShort(m.deadlineTs)} {new Date(m.deadlineTs * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
          <span className={`chip ${STATE_TONE[m.state]}`}>{STATE_LABEL[m.state]}</span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div className="price-tile price-yes !py-2"><span>Yes</span><strong className="!text-base">{odds === null ? '--' : `${Math.round(odds.yes * 100)}%`}</strong></div>
          <div className="price-tile price-no !py-2"><span>No</span><strong className="!text-base">{odds === null ? '--' : `${Math.round(odds.no * 100)}%`}</strong></div>
        </div>
        <div className="mono mt-1.5 flex flex-wrap gap-x-3 text-[11px] text-fog-2">
          <span><span className="text-yes">{fmtQuote(yes, '')}</span>yes · <span className="text-no">{fmtQuote(no, '')}</span>no {pool.quote.symbol}</span>
          <span>{m.state === 'open' ? (left > 0 ? `${ago(left)} left` : `deadline passed ${ago(-left)} ago`) : m.resolvedAt ? `resolved ${ago(now - m.resolvedAt)} ago` : ''}</span>
          {position && !position.claimed && <span className="text-paper">you: {fmtQuote(Number(position.yesAmountRaw) / 10 ** d, '')}yes {fmtQuote(Number(position.noAmountRaw) / 10 ** d, '')}no</span>}
        </div>
      </button>
    </li>
  );
}

function MarketActions({ m, pool, now, live, wallet, position, busy, step, acting, onStake, onResolve, onClaim }: {
  m: MarketAccount; pool: CurvePool; now: number; live: boolean; wallet: string | null; position: PositionAccount | null;
  busy: boolean; step: Step; acting: Action | null;
  onStake: (side: Side, amountRaw: bigint) => void; onResolve: () => void; onClaim: () => void;
}) {
  const [side, setSide] = useState<Side>('yes');
  const [amount, setAmount] = useState(pool.quote.decimals === 9 ? '0.01' : '1');
  const d = pool.quote.decimals;
  const multiple = (s: Side) => sideMultiple(m, s);
  const amountRaw = BigInt(Math.round((Number(amount) || 0) * 10 ** d));
  const tooSmall = amountRaw < BigInt(Number(MIN_STAKE));
  const open = m.state === 'open' && now <= m.deadlineTs;
  // the program's decision function: when it returns a side, resolve goes through now
  const verdict = decide(pool, m.deadlineTs, now);
  const resolvable = m.state === 'open' && verdict !== null;
  const mine = position && !position.claimed ? position : null;
  const payout = mine ? Number(positionPayout(m, mine).now ?? 0n) : 0;
  const claimable = !!mine && m.state !== 'open';
  const label = (idle: string) => step === 'building' ? 'Building transaction…' : step === 'signing' ? 'Approve in wallet…' : step === 'broadcasting' ? 'Broadcasting…' : idle;
  const isActing = (kind: Action['kind']) => acting?.kind === kind && acting && 'market' in acting && acting.market === m.address;

  return (
    <div className="mt-3 space-y-3">
      {open && (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (!tooSmall) onStake(side, amountRaw); }}>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Side">
            {(['yes', 'no'] as const).map((s) => (
              <button type="button" key={s} role="radio" aria-checked={side === s} onClick={() => setSide(s)} className={`btn h-9 ${side === s ? (s === 'yes' ? 'btn-yes' : 'btn-no') : ''}`}>
                {s.toUpperCase()} <span className="mono text-xs opacity-80">{multiple(s) ? `${multiple(s)!.toFixed(2)}x` : 'first in'}</span>
              </button>
            ))}
          </div>
          <div>
            <label htmlFor="gm-amt" className="label">Stake ({pool.quote.symbol})</label>
            <input id="gm-amt" className="field mono" type="number" inputMode="decimal" min={Number(MIN_STAKE) / 10 ** d} step={Number(MIN_STAKE) / 10 ** d} value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </div>
          {!live ? null : !wallet ? <WalletButton /> : (
            <button type="submit" disabled={busy || tooSmall} className="btn btn-primary h-9 w-full">{isActing('stake') ? label('') : `Sign & stake ${side.toUpperCase()}`}</button>
          )}
          <p className="text-[11px] text-fog-2">
            {pool.quote.mint === 'So11111111111111111111111111111111111111112' ? 'SOL is wrapped for the stake inside the same transaction and unwrapped again on claim.' : `The stake moves from your ${pool.quote.symbol} token account into the market vault.`}
            {multiple(side) ? ` At today's totals a ${side.toUpperCase()} win pays ${multiple(side)!.toFixed(2)}x.` : ''}
          </p>
        </form>
      )}
      {m.state === 'open' && !open && !resolvable && <p className="text-xs text-fog-2">The deadline has passed. Resolve becomes possible once the chain clock is past it too.</p>}
      {resolvable && (
        <div className="rounded-md border border-line bg-ink p-3 text-xs">
          <p className="text-fog">The pool shows {verdict === 'yes' ? 'the curve filled in time' : 'the deadline passed without a fill'}: resolve settles it <span className={verdict === 'yes' ? 'text-yes' : 'text-no'}>{verdict!.toUpperCase()}</span>{resolvedState(m, verdict!) === 'refund' ? ', as a refund (one side has no stake)' : ''}. Anyone may call it.</p>
          {live && wallet && <button type="button" className="btn mt-2 h-9 w-full" disabled={busy} onClick={onResolve}>{isActing('resolve') ? label('') : 'Sign & resolve'}</button>}
        </div>
      )}
      {claimable && (
        <div className="rounded-md border border-yes/40 bg-yes/10 p-3 text-xs">
          <p className="text-paper">{payout > 0 ? <>You can claim <span className="mono">{fmtQuote(payout / 10 ** d, pool.quote.symbol)}</span>{m.state === 'refund' ? ' back' : ''}.</> : 'This position lost. Claiming returns the position rent.'}</p>
          {live && wallet && <button type="button" className="btn btn-primary mt-2 h-9 w-full" disabled={busy} onClick={onClaim}>{isActing('claim') ? label('') : 'Sign & claim'}</button>}
        </div>
      )}
      {mine && m.state === 'open' && <p className="text-[11px] text-fog-2">Your stake: {fmtQuote(Number(mine.yesAmountRaw) / 10 ** d, '')}YES, {fmtQuote(Number(mine.noAmountRaw) / 10 ** d, '')}NO. Claim opens once the market resolves.</p>}
    </div>
  );
}

function OpenForm({ pool, now, wallet, busy, step, onSubmit, onCancel }: { pool: CurvePool; now: number; wallet: string | null; busy: boolean; step: Step; onSubmit: (deadline: number) => void; onCancel: () => void }) {
  const [secs, setSecs] = useState<number | null>(86400);
  const [custom, setCustom] = useState('');
  const deadline = secs !== null ? Math.floor(now) + secs : custom ? Math.floor(new Date(custom).getTime() / 1000) : NaN;
  const ok = Number.isFinite(deadline) && deadline > now + 60 && deadline < now + 180 * 86400;
  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (ok) onSubmit(deadline); }}>
      <p className="label !mb-0">Graduates by</p>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Deadline">
        {PRESETS.map((p) => <button type="button" key={p.secs} role="radio" aria-checked={secs === p.secs} onClick={() => { setSecs(p.secs); setCustom(''); }} className={`chip border px-2.5 py-1 ${secs === p.secs ? 'border-ping/50 bg-ping/15 text-ping' : 'border-line text-fog hover:text-paper'}`}>{p.label}</button>)}
        <input type="datetime-local" aria-label="Custom deadline" className="field h-8 w-auto flex-1 text-xs" value={custom} onChange={(e) => { setCustom(e.target.value); setSecs(null); }} />
      </div>
      <p className="text-[11px] text-fog-2">
        {ok ? <>Resolves YES if the curve fills by {dateShort(deadline)} {new Date(deadline * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}, NO once that passes. Opening costs about 0.0034 SOL of rent; the creator gets no fee.</> : 'Pick a deadline at least a minute and at most 180 days away.'}
      </p>
      <div className="flex gap-2">
        <button type="button" className="btn h-9" onClick={onCancel} disabled={busy}>Cancel</button>
        {!wallet ? <WalletButton /> : <button type="submit" className="btn btn-primary h-9 flex-1" disabled={busy || !ok}>{step === 'building' ? 'Building transaction…' : step === 'signing' ? 'Approve in wallet…' : step === 'broadcasting' ? 'Broadcasting…' : 'Sign & open market'}</button>}
      </div>
      {pool.status !== 'trading' && <p className="text-xs text-no">The curve is already complete; the program refuses a market on it.</p>}
    </form>
  );
}
