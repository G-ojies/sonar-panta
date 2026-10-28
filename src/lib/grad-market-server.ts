/**
 * Server reads for the pm-AMM graduation markets (grad-market.ts): every grad_resolver binding on devnet, joined with
 * its pm-AMM market, its DBC pool's progress and the vault, cached briefly in the store so a page poll does not turn
 * into a getProgramAccounts per visitor. Reads go through `marketRpc` (curve-market-server.ts), the devnet endpoint
 * the curve_market reads use.
 */
import { marketRpc } from './curve-market-server';
import { decodeConfig, decodePool } from './dbc';
import {
  ata, BINDING_SIZE, decodeBinding, decodePmMarket, GRAD_PROGRAM, MUSDC, phaseOf, yesPrice, deriveMarket,
  type GradBinding, type MarketPhase, type PmMarketState,
} from './grad-market';
import { store } from './store';

export interface GradMarketView {
  binding: GradBinding;
  pm: PmMarketState | null;
  /** YES price in [0, 1]; null while halted (no liquidity). */
  yesPrice: number | null;
  phase: MarketPhase;
  pool: { progress: number; complete: boolean; quoteReserveRaw: string; thresholdRaw: string } | null;
  /** mUSDC held by the pm-AMM vault, base units. */
  vaultRaw: string;
  /** Creator fees collected by the market's PDA so far, base units. */
  feesRaw: string;
}

export interface GradUser {
  wallet: string;
  musdcRaw: string;
  /** Outcome tokens held per binding, base units. */
  holdings: Record<string, { yesRaw: string; noRaw: string }>;
}

export interface GradPayload {
  program: string;
  updatedAt: number;
  markets: GradMarketView[];
  user: GradUser | null;
}

type RpcAccount = { data: [string, string]; owner: string } | null;
const b64 = (a: RpcAccount) => (a ? Buffer.from(a.data[0], 'base64') : null);
const tokenAmount = (a: RpcAccount) => { const d = b64(a); return d && d.length >= 72 ? d.readBigUInt64LE(64).toString() : '0'; };

async function multiple(keys: string[]): Promise<RpcAccount[]> {
  const out: RpcAccount[] = [];
  for (let i = 0; i < keys.length; i += 100) {
    const r = await marketRpc<{ value: RpcAccount[] }>('getMultipleAccounts', [keys.slice(i, i + 100), { encoding: 'base64', commitment: 'confirmed' }]);
    out.push(...r.value);
  }
  return out;
}

const K = 'sonar:grad:markets:devnet';
const CACHE_S = 20;
interface Cache { updatedAt: number; markets: GradMarketView[] }
let memo: Cache | null = null;

/** Every graduation market, newest deadline first among the ones still trading. */
export async function readAllGradMarkets(fresh = false): Promise<Cache> {
  const now = Date.now() / 1000;
  if (!fresh && memo && now - memo.updatedAt < CACHE_S) return memo;
  const s = store();
  if (!fresh) {
    const cached = await s.get<Cache>(K);
    if (cached && now - cached.updatedAt < CACHE_S) return (memo = cached);
  }
  const raw = await marketRpc<{ pubkey: string; account: { data: [string, string] } }[]>('getProgramAccounts', [
    GRAD_PROGRAM, { encoding: 'base64', commitment: 'confirmed', filters: [{ dataSize: BINDING_SIZE }] },
  ]);
  const bindings = raw.flatMap((x) => { try { return [decodeBinding(Buffer.from(x.account.data[0], 'base64'), x.pubkey)]; } catch { return []; } });
  const pools = [...new Set(bindings.map((b) => b.pool))];
  const [pmAccs, poolAccs, vaultAndFees] = await Promise.all([
    multiple(bindings.map((b) => b.pmMarket)),
    multiple(pools),
    multiple(bindings.flatMap((b) => { const d = deriveMarket(b.address); return [d.pmVault.toBase58(), d.collateral.toBase58()]; })),
  ]);
  const configKeys = poolAccs.map((a) => { const d = b64(a); try { return d ? decodePool(d).config : null; } catch { return null; } });
  const configAccs = await multiple([...new Set(configKeys.filter((c): c is string => !!c))]);
  const configByKey = new Map([...new Set(configKeys.filter((c): c is string => !!c))].map((k, i) => [k, configAccs[i]]));

  const poolView = new Map<string, GradMarketView['pool']>();
  pools.forEach((p, i) => {
    const d = b64(poolAccs[i]);
    const c = configKeys[i] ? b64(configByKey.get(configKeys[i]!) ?? null) : null;
    if (!d || !c) return poolView.set(p, null);
    try {
      const ps = decodePool(d), cs = decodeConfig(c);
      const reserve = BigInt(ps.quote_reserve), threshold = BigInt(cs.migration_quote_threshold);
      const complete = Number(ps.is_migrated) === 1 || BigInt(ps.finish_curve_timestamp) > 0n || reserve >= threshold;
      poolView.set(p, { progress: threshold > 0n ? Math.min(1, Number((reserve * 10_000n) / threshold) / 10_000) : 0, complete, quoteReserveRaw: reserve.toString(), thresholdRaw: threshold.toString() });
    } catch { poolView.set(p, null); }
  });

  const markets: GradMarketView[] = bindings.map((b, i) => {
    const d = b64(pmAccs[i]);
    const pm = d ? decodePmMarket(d) : null;
    return {
      binding: b, pm, yesPrice: pm ? yesPrice(pm) : null, phase: phaseOf(b, pm, now), pool: poolView.get(b.pool) ?? null,
      vaultRaw: tokenAmount(vaultAndFees[2 * i]), feesRaw: tokenAmount(vaultAndFees[2 * i + 1]),
    };
  });
  const rank = (m: GradMarketView) => (m.phase === 'trading' ? 0 : m.phase === 'halted' || m.phase === 'expired' ? 1 : 2);
  markets.sort((a, b) => rank(a) - rank(b) || a.binding.deadlineTs - b.binding.deadlineTs);
  const value = { updatedAt: now, markets };
  await s.set(K, value, 300);
  return (memo = value);
}

/** Markets plus, when a wallet is named, its mUSDC and outcome-token balances. */
export async function readGrad(opts: { user?: string; fresh?: boolean } = {}): Promise<GradPayload> {
  const all = await readAllGradMarkets(opts.fresh);
  let user: GradUser | null = null;
  if (opts.user) {
    const withPm = all.markets.filter((m) => m.pm);
    const keys = [ata(opts.user, MUSDC).toBase58(), ...withPm.flatMap((m) => [ata(opts.user!, m.pm!.yesMint).toBase58(), ata(opts.user!, m.pm!.noMint).toBase58()])];
    const accs = await multiple(keys);
    const holdings: GradUser['holdings'] = {};
    withPm.forEach((m, i) => {
      const yesRaw = tokenAmount(accs[1 + 2 * i]), noRaw = tokenAmount(accs[2 + 2 * i]);
      if (yesRaw !== '0' || noRaw !== '0') holdings[m.binding.address] = { yesRaw, noRaw };
    });
    user = { wallet: opts.user, musdcRaw: tokenAmount(accs[0]), holdings };
  }
  return { program: GRAD_PROGRAM, updatedAt: all.updatedAt, markets: all.markets, user };
}
