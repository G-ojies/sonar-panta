'use client';
import { useSandbox } from './useSandbox';

export function SandboxToggle() {
  const [on, set] = useSandbox();
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => set(!on)} title={on ? 'Sandbox: Panta fixtures, nothing on chain. Click for mainnet.' : 'Mainnet. Click for a free sandbox demo.'}
      className={`chip h-7 border px-2 ${on ? 'border-amber/50 bg-amber/15 text-amber' : 'border-line text-fog-2 hover:text-paper'}`}>
      {on ? 'Sandbox' : 'Mainnet'}
    </button>
  );
}

/** Shown under the header whenever sandbox mode is on. */
export function SandboxBanner() {
  const [on] = useSandbox();
  if (!on) return null;
  return (
    <div role="status" className="border-b border-amber/30 bg-amber/10 px-4 py-1.5 text-center text-xs text-amber">
      Sandbox mode: every trade, claim and market creation goes to Panta&apos;s <span className="mono">pk_test_</span> fixtures. No transaction is sent and no funds are needed. Radar data stays live.
    </div>
  );
}
