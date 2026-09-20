/**
 * Browser-side helpers: turn Panta's unsigned instruction lists into a
 * VersionedTransaction, have the wallet sign, broadcast on our RPC.
 */
import {
  Connection, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction,
} from '@solana/web3.js';
import type { BuiltInstruction } from './types';

export const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC ?? 'https://api.mainnet-beta.solana.com';
export const CLUSTER = process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? 'mainnet-beta';

export function toInstruction(ix: BuiltInstruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programId),
    keys: ix.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
    data: Buffer.from(ix.data, 'base64'),
  });
}

export function compile(payer: PublicKey, instructions: BuiltInstruction[], recentBlockhash: string): VersionedTransaction {
  const msg = new TransactionMessage({ payerKey: payer, recentBlockhash, instructions: instructions.map(toInstruction) }).compileToV0Message();
  return new VersionedTransaction(msg);
}

export function deserialize(base64: string): VersionedTransaction {
  return VersionedTransaction.deserialize(Buffer.from(base64, 'base64'));
}

export async function broadcast(conn: Connection, tx: VersionedTransaction, lastValidBlockHeight?: number): Promise<string> {
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  const bh = tx.message.recentBlockhash;
  await conn.confirmTransaction(
    { signature: sig, blockhash: bh, lastValidBlockHeight: lastValidBlockHeight ?? (await conn.getLatestBlockhash()).lastValidBlockHeight },
    'confirmed',
  );
  return sig;
}

export const explorerTx = (sig: string) => `https://solscan.io/tx/${sig}${CLUSTER === 'devnet' ? '?cluster=devnet' : ''}`;
export const explorerAddr = (a: string) => `https://solscan.io/account/${a}${CLUSTER === 'devnet' ? '?cluster=devnet' : ''}`;
export const short = (a: string, n = 4) => (a.length > 2 * n + 1 ? `${a.slice(0, n)}…${a.slice(-n)}` : a);
