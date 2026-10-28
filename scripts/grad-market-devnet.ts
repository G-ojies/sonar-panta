/**
 * Drive the grad_resolver program (pm-AMM graduation markets) on devnet from a keypair file:
 *
 *   npx tsx scripts/grad-market-devnet.ts find                                   open DBC pools seen on the recent tape
 *   npx tsx scripts/grad-market-devnet.ts open <pool> <seconds-ahead> <seed>     open a market, seed in collateral units
 *   npx tsx scripts/grad-market-devnet.ts show <binding>
 *   npx tsx scripts/grad-market-devnet.ts buy <binding> yes|no <amount>          trade straight through pm-AMM
 *   npx tsx scripts/grad-market-devnet.ts halt|resolve|settle <binding>
 *   npx tsx scripts/grad-market-devnet.ts keep                                    crank every market that is due
 *
 * KEYPAIR (default ~/.config/solana/id.json) signs; RPC is where it goes (default SOLANA_DEVNET_RPC
 * from .env.local, else the public devnet endpoint). COLLATERAL defaults to pm-AMM's devnet mUSDC,
 * which its faucet hands out: POST https://pm-amm-devnet.vercel.app/api/faucet {"wallet": "<pubkey>"}.
 */
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, TransactionInstruction,
  TransactionMessage, VersionedTransaction, type AccountMeta,
} from '@solana/web3.js';
import { DBC_PROGRAM, decodeConfig, decodePool, printsFromTx, type DbcTx } from '../src/lib/dbc';

const envRpc = (() => {
  try {
    return /^SOLANA_DEVNET_RPC=(.+)$/m.exec(fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf8'))?.[1]?.trim();
  } catch {
    return undefined;
  }
})();
const RPC = process.env.RPC ?? envRpc ?? 'https://api.devnet.solana.com';
const conn = new Connection(RPC, 'confirmed');
const keypairPath = process.env.KEYPAIR ?? path.join(os.homedir(), '.config/solana/id.json');
const signer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, 'utf8'))));

const GRAD = new PublicKey('73G7X9FKEgTtNQMBWGsCGZfHHBpvVxsJ9kqvV6mvubJH');
const PM = new PublicKey('GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y');
const MPL = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const PROTOCOL_DAO = new PublicKey('4qXyczAr5DuBVaHUwmZT5Xt6hgQ6RwqBYcFGtrv8QEph');
const COLLATERAL = new PublicKey(process.env.COLLATERAL ?? '3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ');
const DECIMALS = 6;
const SWAP_DISC = Buffer.from([248, 198, 158, 145, 225, 117, 135, 200]);

const pda = (seeds: (Buffer | Uint8Array)[], program: PublicKey) => PublicKey.findProgramAddressSync(seeds, program)[0];
const ixDisc = (name: string) => crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
const ata = (owner: PublicKey, mint = COLLATERAL) => pda([owner.toBuffer(), TOKEN.toBuffer(), mint.toBuffer()], ATA_PROGRAM);
const w = (pubkey: PublicKey, isSigner = false): AccountMeta => ({ pubkey, isSigner, isWritable: true });
const r = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: false, isWritable: false });
const i64 = (n: number | bigint) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
const u64 = (n: number | bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const units = (s: string) => BigInt(Math.round(Number(s) * 10 ** DECIMALS));

/** Every address a binding implies. */
function derive(binding: PublicKey) {
  const authority = pda([Buffer.from('authority'), binding.toBuffer()], GRAD);
  const marketId = binding.toBuffer().subarray(0, 8);
  const pmMarket = pda([Buffer.from('market'), marketId], PM);
  const yesMint = pda([Buffer.from('yes_mint'), pmMarket.toBuffer()], PM);
  const noMint = pda([Buffer.from('no_mint'), pmMarket.toBuffer()], PM);
  return {
    authority, pmMarket, yesMint, noMint,
    pmVault: pda([Buffer.from('vault'), pmMarket.toBuffer()], PM),
    lpPosition: pda([Buffer.from('lp'), pmMarket.toBuffer(), authority.toBuffer()], PM),
    collateral: pda([Buffer.from('collateral'), binding.toBuffer()], GRAD),
    authYes: pda([Buffer.from('yes'), binding.toBuffer()], GRAD),
    authNo: pda([Buffer.from('no'), binding.toBuffer()], GRAD),
    yesMeta: pda([Buffer.from('metadata'), MPL.toBuffer(), yesMint.toBuffer()], MPL),
    noMeta: pda([Buffer.from('metadata'), MPL.toBuffer(), noMint.toBuffer()], MPL),
  };
}

interface Binding {
  pool: PublicKey; config: PublicKey; pmMarket: PublicKey; opener: PublicKey; collateralMint: PublicKey;
  deadline: bigint; threshold: bigint; seed: bigint; halted: boolean; resolved: boolean; settled: boolean;
}

async function fetchBinding(key: PublicKey): Promise<Binding> {
  const acc = await conn.getAccountInfo(key);
  if (!acc) throw new Error(`no binding at ${key.toBase58()}`);
  const d = acc.data;
  const pk = (o: number) => new PublicKey(d.subarray(o, o + 32));
  return {
    pool: pk(8), config: pk(40), pmMarket: pk(72), opener: pk(104), collateralMint: pk(136),
    deadline: d.readBigInt64LE(168), threshold: d.readBigUInt64LE(176), seed: d.readBigUInt64LE(192),
    halted: d[200] === 1, resolved: d[201] === 1, settled: d[202] === 1,
  };
}

/** Create an associated token account if missing (the idempotent ATA instruction). */
const ataIdempotent = (owner: PublicKey, mint: PublicKey) => new TransactionInstruction({
  programId: ATA_PROGRAM,
  keys: [w(signer.publicKey, true), w(ata(owner, mint)), r(owner), r(mint), r(SystemProgram.programId), r(TOKEN)],
  data: Buffer.from([1]),
});

async function send(ixs: TransactionInstruction[], cu = 400_000): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  const all = [ComputeBudgetProgram.setComputeUnitLimit({ units: cu }), ...ixs];
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: signer.publicKey, recentBlockhash: blockhash, instructions: all }).compileToV0Message());
  tx.sign([signer]);
  try {
    const sig = await conn.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
    await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    return sig;
  } catch (e) {
    const logs = (e as { logs?: string[] }).logs;
    throw new Error(`${(e as Error).message}${logs ? `\n  ${logs.slice(-8).join('\n  ')}` : ''}`);
  }
}

async function poolStatus(pool: PublicKey) {
  const pa = await conn.getAccountInfo(pool);
  if (!pa || !pa.owner.equals(new PublicKey(DBC_PROGRAM))) return null;
  const p = decodePool(Buffer.from(pa.data));
  const ca = await conn.getAccountInfo(new PublicKey(p.config));
  if (!ca) return null;
  const c = decodeConfig(Buffer.from(ca.data));
  const threshold = BigInt(c.migration_quote_threshold);
  const reserve = BigInt(p.quote_reserve);
  const complete = Number(p.is_migrated) === 1 || BigInt(p.finish_curve_timestamp) > 0n || reserve >= threshold;
  return { config: new PublicKey(p.config), reserve, threshold, complete, progress: Number((reserve * 10_000n) / (threshold || 1n)) / 100 };
}

async function main() {
  const [cmd, ...a] = process.argv.slice(2);
  console.log(`wallet ${signer.publicKey.toBase58()} ${(await conn.getBalance(signer.publicKey)) / 1e9} SOL`);

  if (cmd === 'find') {
    const sigs = await conn.getSignaturesForAddress(new PublicKey(DBC_PROGRAM), { limit: 60 });
    const pools = new Set<string>();
    for (const s of sigs.filter((x) => !x.err).slice(0, 30)) {
      const res = await fetch(RPC, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [s.signature, { encoding: 'json', maxSupportedTransactionVersion: 1, commitment: 'confirmed' }] }),
      });
      const tx = ((await res.json()) as { result?: DbcTx }).result;
      if (tx) for (const p of printsFromTx(s.signature, tx)) pools.add(p.pool);
    }
    for (const p of pools) {
      const st = await poolStatus(new PublicKey(p));
      if (st) console.log(`${p}  ${st.complete ? 'COMPLETE' : 'open'}  ${st.progress}% of threshold`);
    }
    return;
  }

  if (cmd === 'open') {
    const pool = new PublicKey(a[0]);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + Number(a[1]));
    const seed = units(a[2]);
    const st = await poolStatus(pool);
    if (!st) throw new Error('not a DBC pool');
    if (st.complete) throw new Error('pool already complete');
    const binding = pda([Buffer.from('binding'), pool.toBuffer(), i64(deadline)], GRAD);
    const d = derive(binding);
    const name = `Graduates by ${new Date(Number(deadline) * 1000).toISOString().slice(0, 16)}Z?`;
    const nameBuf = Buffer.from(name);
    const data = Buffer.concat([ixDisc('open_market'), i64(deadline), u16(Number(a[3] ?? 5000)), u64(seed), u64(nameBuf.length).subarray(0, 4), nameBuf]);
    const ix = new TransactionInstruction({
      programId: GRAD,
      keys: [
        w(signer.publicKey, true), r(pool), r(st.config), w(binding), w(d.authority), r(COLLATERAL), w(ata(signer.publicKey)),
        w(d.collateral), w(d.pmMarket), w(d.yesMint), w(d.noMint), w(d.pmVault), w(d.yesMeta), w(d.noMeta), w(d.lpPosition),
        r(PM), r(MPL), r(TOKEN), r(SystemProgram.programId), r(SYSVAR_RENT_PUBKEY),
      ],
      data,
    });
    console.log('binding', binding.toBase58(), 'pm market', d.pmMarket.toBase58());
    console.log('signature', await send([ix], 1_400_000));
    return;
  }

  if (cmd === 'keep') {
    // Binding: 8 discriminator + 5 pubkeys + 4 u64/i64 + 3 bools + 2 bumps.
    const all = await conn.getProgramAccounts(GRAD, { filters: [{ dataSize: 8 + 5 * 32 + 4 * 8 + 3 + 2 }] });
    const now = BigInt(Math.floor(Date.now() / 1000));
    for (const { pubkey } of all) {
      const b = await fetchBinding(pubkey);
      const st = await poolStatus(b.pool);
      const known = !!st?.complete || now > b.deadline;
      const step = b.settled ? null : b.resolved ? 'settle' : !b.halted ? (known ? 'halt' : null) : now >= b.deadline ? 'resolve' : null;
      if (!step) { console.log(`${pubkey.toBase58()}  nothing due`); continue; }
      try {
        console.log(`${pubkey.toBase58()}  ${step}  ${await crank(step, pubkey, b)}`);
      } catch (e) {
        console.log(`${pubkey.toBase58()}  ${step} failed: ${(e as Error).message.split('\n')[0]}`);
      }
    }
    return;
  }

  const binding = new PublicKey(a[0]);
  const b = await fetchBinding(binding);
  const d = derive(binding);

  if (cmd === 'show') {
    const st = await poolStatus(b.pool);
    const bal = async (k: PublicKey) => (await conn.getTokenAccountBalance(k).catch(() => null))?.value.uiAmountString ?? '-';
    console.log({
      pool: b.pool.toBase58(), pmMarket: b.pmMarket.toBase58(), opener: b.opener.toBase58(),
      deadline: new Date(Number(b.deadline) * 1000).toISOString(), seed: Number(b.seed) / 10 ** DECIMALS,
      halted: b.halted, resolved: b.resolved, settled: b.settled, poolComplete: st?.complete, poolProgress: `${st?.progress}%`,
      vault: await bal(d.pmVault), creatorFees: await bal(d.collateral), lpYes: await bal(d.authYes), lpNo: await bal(d.authNo),
    });
    return;
  }

  if (cmd === 'buy') {
    const toYes = a[1] === 'yes';
    const amount = units(a[2]);
    const daoAta = ata(PROTOCOL_DAO);
    const data = Buffer.concat([SWAP_DISC, Buffer.from([toYes ? 0 : 1]), u64(amount), u64(0)]);
    const swap = new TransactionInstruction({
      programId: PM,
      keys: [
        w(signer.publicKey, true), w(b.pmMarket), r(COLLATERAL), w(d.yesMint), w(d.noMint), w(d.pmVault),
        w(ata(signer.publicKey)), w(ata(signer.publicKey, d.yesMint)), w(ata(signer.publicKey, d.noMint)), w(daoAta), w(d.collateral), r(TOKEN),
      ],
      data,
    });
    console.log('signature', await send([
      ataIdempotent(signer.publicKey, d.yesMint), ataIdempotent(signer.publicKey, d.noMint), ataIdempotent(PROTOCOL_DAO, COLLATERAL), swap,
    ], 600_000));
    return;
  }

  console.log('signature', await crank(cmd, binding, b));
}

function crank(cmd: string, binding: PublicKey, b: Binding): Promise<string> {
  const d = derive(binding);
  const keys: Record<string, AccountMeta[]> = {
    halt: [
      w(signer.publicKey, true), w(binding), r(b.pool), r(b.config), w(d.authority), w(b.pmMarket), r(COLLATERAL),
      w(d.yesMint), w(d.noMint), w(d.lpPosition), w(d.authYes), w(d.authNo), r(PM), r(TOKEN), r(SystemProgram.programId),
    ],
    resolve: [w(binding), r(b.pool), r(b.config), r(d.authority), w(b.pmMarket), r(PM)],
    settle: [
      w(binding), w(d.authority), r(b.pmMarket), r(COLLATERAL), w(d.yesMint), w(d.noMint), w(d.pmVault), w(d.collateral),
      w(d.authYes), w(d.authNo), w(ata(b.opener)), r(PM), r(TOKEN),
    ],
  };
  if (!keys[cmd]) throw new Error(`unknown command ${cmd}`);
  return send([new TransactionInstruction({ programId: GRAD, keys: keys[cmd], data: ixDisc(cmd) })]);
}

main().catch((e) => { console.error((e as Error).message); process.exit(1); });
