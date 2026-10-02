/**
 * Drive the curve_market program on devnet from a keypair file, with the same builders the pool page uses:
 *
 *   npx tsx scripts/curve-market-devnet.ts markets [pool]                    list markets (and a wallet's positions)
 *   npx tsx scripts/curve-market-devnet.ts create <pool> <seconds-ahead>     open a market on a DBC VirtualPool
 *   npx tsx scripts/curve-market-devnet.ts stake <market> yes|no <amount>    stake, amount in the quote token (SOL)
 *   npx tsx scripts/curve-market-devnet.ts resolve <market>
 *   npx tsx scripts/curve-market-devnet.ts claim <market>
 *   npx tsx scripts/curve-market-devnet.ts fund <pubkey> <sol>               send SOL to a second wallet
 *
 * KEYPAIR (default ~/.config/solana/id.json) signs; RPC (default the public devnet endpoint) is where it goes.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Connection, Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import {
  DEVNET_RPC, associatedTokenAddress, claimPlan, createMarketIx, fetchMarket, fetchMarkets, fetchPositions, friendlyProgramError, positionPayout, stakePlan, type RpcCall,
} from '../src/lib/curve-market';
import { decodePoolConfig, decodeVirtualPool } from '../src/lib/dbc';

const RPC = process.env.RPC ?? DEVNET_RPC;
const conn = new Connection(RPC, 'confirmed');
const keypairPath = process.env.KEYPAIR ?? path.join(os.homedir(), '.config/solana/id.json');
const signer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, 'utf8'))));

const call: RpcCall = async <T,>(method: string, params: unknown[]): Promise<T> => {
  for (let i = 0; ; i++) {
    const res = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const j = (await res.json().catch(() => ({ error: { message: `http ${res.status}` } }))) as { result?: T; error?: { message: string } };
    if (!j.error) return j.result as T;
    if (i >= 4) throw new Error(j.error.message);
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
};

async function send(ixs: import('@solana/web3.js').TransactionInstruction[]): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: signer.publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
  tx.sign([signer]);
  try {
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
    await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    return sig;
  } catch (e) {
    const logs = (e as { logs?: string[] }).logs;
    throw new Error(`${friendlyProgramError((e as Error).message)}${logs ? `\n  ${logs.slice(-6).join('\n  ')}` : ''}`);
  }
}

const sol = (lamports: bigint | number) => `${(Number(lamports) / 1e9).toFixed(6)} SOL`;

async function main() {
  const [cmd, ...a] = process.argv.slice(2);
  console.log(`wallet ${signer.publicKey.toBase58()} balance ${sol(await conn.getBalance(signer.publicKey))} on ${RPC}`);
  if (cmd === 'markets') {
    const markets = await fetchMarkets(call, a[0]);
    const positions = await fetchPositions(call, signer.publicKey.toBase58());
    for (const m of markets) {
      const p = positions.find((x) => x.market === m.address);
      console.log(`${m.address} pool ${m.pool} deadline ${new Date(m.deadlineTs * 1000).toISOString()} state ${m.state} yes ${sol(BigInt(m.yesTotalRaw))} no ${sol(BigInt(m.noTotalRaw))} paid ${sol(BigInt(m.paidOutRaw))}`
        + (p ? ` | mine yes ${sol(BigInt(p.yesAmountRaw))} no ${sol(BigInt(p.noAmountRaw))} claimed ${p.claimed} payout now ${positionPayout(m, p).now === null ? '-' : sol(positionPayout(m, p).now!)}` : ''));
    }
    if (!markets.length) console.log('no markets');
  } else if (cmd === 'create') {
    const pool = a[0]; const ahead = Number(a[1] ?? 3600);
    const info = await conn.getAccountInfo(new PublicKey(pool));
    if (!info) throw new Error('pool account missing');
    const state = decodeVirtualPool(info.data);
    const cfgInfo = await conn.getAccountInfo(new PublicKey(state.config));
    const cfg = decodePoolConfig(cfgInfo!.data);
    const mintInfo = await conn.getAccountInfo(new PublicKey(cfg.quote_mint));
    const deadline = Math.floor(Date.now() / 1000) + ahead;
    const { ix, market, vault } = createMarketIx(signer.publicKey, { pool, config: state.config, quoteMint: cfg.quote_mint, tokenProgram: mintInfo!.owner.toBase58() }, deadline);
    console.log(`creating market ${market.toBase58()} vault ${vault.toBase58()} deadline ${deadline} (${new Date(deadline * 1000).toISOString()}) quote ${cfg.quote_mint}`);
    console.log('signature', await send([ix]));
  } else if (cmd === 'stake') {
    const m = await fetchMarket(call, a[0]); if (!m) throw new Error('no such market');
    const side = a[1] as 'yes' | 'no'; const amount = BigInt(Math.round(Number(a[2]) * 1e9));
    const ata = associatedTokenAddress(signer.publicKey, m.quoteMint, m.tokenProgram);
    const exists = !!(await conn.getAccountInfo(ata));
    console.log(`staking ${sol(amount)} on ${side.toUpperCase()} of ${m.address} via ATA ${ata.toBase58()} (${exists ? 'exists' : 'new'})`);
    console.log('signature', await send(stakePlan(signer.publicKey, m, side, amount, exists)));
  } else if (cmd === 'resolve') {
    const m = await fetchMarket(call, a[0]); if (!m) throw new Error('no such market');
    const { resolveIx } = await import('../src/lib/curve-market');
    console.log('signature', await send([resolveIx(m)]));
    const after = await fetchMarket(call, a[0]);
    console.log('state now', after?.state, 'resolved at', after?.resolvedAt);
  } else if (cmd === 'claim') {
    const m = await fetchMarket(call, a[0]); if (!m) throw new Error('no such market');
    const ata = associatedTokenAddress(signer.publicKey, m.quoteMint, m.tokenProgram);
    const exists = !!(await conn.getAccountInfo(ata));
    console.log('signature', await send(claimPlan(signer.publicKey, m, exists)));
  } else if (cmd === 'fund') {
    console.log('signature', await send([SystemProgram.transfer({ fromPubkey: signer.publicKey, toPubkey: new PublicKey(a[0]), lamports: Math.round(Number(a[1]) * 1e9) })]));
  } else {
    console.log('commands: markets [pool] | create <pool> <seconds> | stake <market> yes|no <sol> | resolve <market> | claim <market> | fund <pubkey> <sol>');
  }
  console.log(`balance after ${sol(await conn.getBalance(signer.publicKey))}`);
}
main().catch((e) => { console.error('failed:', (e as Error).message); process.exit(1); });
