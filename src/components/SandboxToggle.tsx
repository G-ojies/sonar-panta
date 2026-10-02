'use client';
import { useSandbox } from './useSandbox';

/** The cluster the wallet flows run on; the devnet build is where the graduation markets are. */
const NET = process.env.NEXT_PUBLIC_SOLANA_CLUSTER === 'devnet' ? 'Devnet' : 'Mainnet';

export function SandboxToggle() {
  const [on, set] = useSandbox();
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => set(!on)} title={on ? `Sandbox: nothing on chain. Click to switch to ${NET.toLowerCase()}.` : `${NET}. Click to try everything free in the sandbox.`}
      className={`chip h-7 border px-2 ${on ? 'border-amber/50 bg-amber/15 text-amber' : 'border-line text-fog-2 hover:text-paper'}`}>
      {on ? 'Sandbox' : NET}
    </button>
  );
}

/** Shown under the header whenever sandbox mode is on. */
export function SandboxBanner() {
  const [on] = useSandbox();
  if (!on) return null;
  return (
    <div role="status" className="border-b border-amber/30 bg-amber/10 px-4 py-1.5 text-center text-xs text-amber">
      Sandbox on: trades, claims and new markets run against Panta&apos;s test fixtures. Nothing is sent on chain and no funds are needed. Radar data stays live.
    </div>
  );
}
