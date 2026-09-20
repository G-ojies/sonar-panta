'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import type { Position } from '@/lib/types';
import { cents, usd, untilText } from '@/lib/format';
import { broadcast, compile, explorerTx } from '@/lib/solana';
import { postJson, useApi } from './useApi';
import { WalletButton } from './WalletButton';
import { PoweredByPanta } from './PoweredByPanta';

type Row = Position & { title: string; yesPrice: number | null; value: number | null; endTime: number | null };
interface Payload { wallet: string; summary: { currentValueUsdc: string; primaryContributedUsdc: string } | null; positions: Row[] }

export function PortfolioView() {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const wallet = publicKey?.toBase58() ?? null;
  const { data, error, loading, reload } = useApi<Payload>(wallet ? `/api/positions?wallet=${wallet}` : null, [wallet], 60_000);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const now = Date.now() / 1000;

  async function claim(marketId: string) {
    if (!wallet || !publicKey || !signTransaction) return;
    setClaiming(marketId); setMsg(null);
    try {
      const b = await postJson<{ instructions: never[]; recentBlockhash: string; lastValidBlockHeight?: number }>('/api/claim/build', { wallet, marketId });
      const tx = compile(publicKey, b.instructions, b.recentBlockhash);
      const signed = await signTransaction(tx);
      const sig = await broadcast(connection, signed, b.lastValidBlockHeight);
      try { await postJson('/api/trade/report', { signature: sig, kind: 'claim', wallet }); } catch { /* attribution is best-effort */ }
      setMsg(`Claimed. ${sig}`); reload();
    } catch (e) { const m = (e as Error).message; if (!/reject|cancel/i.test(m)) setMsg(`Claim failed: ${m}`); }
    finally { setClaiming(null); }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Portfolio</h1>
          <p className="mt-1 text-sm text-fog">Your Panta positions, marked to the live YES/NO price. Claim winnings straight from here.</p>
        </div>
        <PoweredByPanta />
      </header>

      {!wallet ? (
        <div className="panel flex flex-col items-center gap-3 p-10 text-center text-sm text-fog">
          <p>Connect a wallet to see its positions.</p><WalletButton />
        </div>
      ) : loading && !data ? (
        <div className="space-y-3" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-14" />)}</div>
      ) : error && !data ? (
        <div className="panel p-8 text-center text-sm"><p className="text-no">{error}</p><button className="btn mt-4" onClick={reload}>Retry</button></div>
      ) : data && data.positions.length === 0 ? (
        <div className="panel p-10 text-center text-sm text-fog">
          No positions for <span className="mono text-paper">{wallet.slice(0, 4)}…{wallet.slice(-4)}</span>. <Link href="/">Find a market on the Radar.</Link>
        </div>
      ) : data && (
        <>
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Mark-to-market" value={usd(data.positions.reduce((a, r) => a + (r.value ?? 0), 0))} />
            <Stat label="Contributed" value={usd(data.summary?.primaryContributedUsdc ?? 0)} />
            <Stat label="Open" value={String(data.positions.filter((r) => !r.outcome).length)} />
            <Stat label="Claimable" value={String(data.positions.filter((r) => r.claimable && !r.claimed).length)} />
          </section>
          <section className="panel overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-fog-2"><tr className="border-b border-line">
                <th className="px-3 py-2 font-medium">Market</th><th className="px-3 py-2 font-medium">Side</th><th className="px-3 py-2 font-medium">Shares</th><th className="px-3 py-2 font-medium">Price</th><th className="px-3 py-2 font-medium">Value</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2" />
              </tr></thead>
              <tbody className="mono">
                {data.positions.map((r) => (
                  <tr key={`${r.marketId}-${r.side}`} className="border-b border-line/60">
                    <td className="max-w-md px-3 py-2 font-sans"><Link href={`/market/${r.marketId}`} className="block truncate text-paper no-underline hover:underline">{r.title || r.marketId}</Link></td>
                    <td className={`px-3 py-2 ${r.side === 'yes' ? 'text-yes' : 'text-no'}`}>{r.side.toUpperCase()}</td>
                    <td className="px-3 py-2">{Number(r.shares).toFixed(2)}</td>
                    <td className="px-3 py-2 text-fog">{r.outcome ? (r.outcome === r.side ? '$1.00' : '$0.00') : cents(r.yesPrice === null ? null : r.side === 'yes' ? r.yesPrice : 1 - r.yesPrice)}</td>
                    <td className="px-3 py-2">{r.value === null ? '—' : usd(r.value)}</td>
                    <td className="px-3 py-2 font-sans text-xs text-fog">{r.outcome ? <span className={r.outcome === r.side ? 'text-yes' : 'text-no'}>{r.outcome === r.side ? 'won' : 'lost'}{r.claimed ? ' · claimed' : ''}</span> : r.endTime ? untilText(r.endTime - now) : r.phase}</td>
                    <td className="px-3 py-2 text-right">{r.claimable && !r.claimed && <button className="btn btn-primary h-8" disabled={claiming === r.marketId} onClick={() => claim(r.marketId)}>{claiming === r.marketId ? 'Claiming…' : 'Claim'}</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          {msg && <p role="status" className="text-xs text-fog">{msg.startsWith('Claimed') ? <>Claimed. <a href={explorerTx(msg.slice(8))} target="_blank" rel="noopener noreferrer">View transaction ↗</a></> : <span className="text-no">{msg}</span>}</p>}
        </>
      )}
    </div>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return <div className="panel px-4 py-3"><div className="text-xs uppercase tracking-wide text-fog-2">{label}</div><div className="mono mt-1 text-2xl font-semibold">{value}</div></div>;
}
