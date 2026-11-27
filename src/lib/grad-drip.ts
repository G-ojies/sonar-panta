import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { GRAD_RPC } from './grad-market';
import { store } from './store';

/**
 * Devnet SOL top-up for new traders. pm-AMM's faucet sends test mUSDC but skips SOL when its own reserve is low
 * ("solSkipped": "reserve"), and a wallet with no SOL cannot pay a single fee. When that happens this sends a small
 * amount of devnet SOL from a devnet-only wallet (GRAD_DRIP_KEY, a JSON secret-key array), once per address and
 * under a daily cap. Nothing here has real value.
 */
export const DRIP_SOL = 0.02;
const MIN_BALANCE_SOL = 0.01;
const DAILY_CAP = 100;
const ONCE_TTL = 60 * 60 * 24 * 30;

export type DripResult = { dripSol: number; dripSignature?: string; dripSkipped?: string };

function dripKey(): Keypair | null {
  const raw = process.env.GRAD_DRIP_KEY;
  if (!raw) return null;
  try { return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw) as number[])); } catch { return null; }
}

export async function dripSol(wallet: string): Promise<DripResult> {
  const payer = dripKey();
  if (!payer) return { dripSol: 0, dripSkipped: 'not-configured' };
  const s = store();
  const onceKey = `grad:drip:${wallet}`;
  if (await s.get(onceKey)) return { dripSol: 0, dripSkipped: 'already-sent' };
  const conn = new Connection(GRAD_RPC, 'confirmed');
  const to = new PublicKey(wallet);
  if ((await conn.getBalance(to)) >= MIN_BALANCE_SOL * LAMPORTS_PER_SOL) return { dripSol: 0, dripSkipped: 'has-sol' };
  const dayKey = `grad:drip:day:${new Date().toISOString().slice(0, 10)}`;
  const today = Number((await s.get<number>(dayKey)) ?? 0);
  if (today >= DAILY_CAP) return { dripSol: 0, dripSkipped: 'daily-cap' };
  // Mark first so a double click cannot send twice; cleared again if the transfer fails.
  await s.set(onceKey, Date.now(), ONCE_TTL);
  await s.set(dayKey, today + 1, 60 * 60 * 26);
  try {
    const { blockhash } = await conn.getLatestBlockhash('confirmed');
    const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: blockhash })
      .add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: to, lamports: Math.round(DRIP_SOL * LAMPORTS_PER_SOL) }));
    tx.sign(payer);
    const sig = await conn.sendRawTransaction(tx.serialize());
    return { dripSol: DRIP_SOL, dripSignature: sig };
  } catch {
    await s.del(onceKey);
    return { dripSol: 0, dripSkipped: 'send-failed' };
  }
}
