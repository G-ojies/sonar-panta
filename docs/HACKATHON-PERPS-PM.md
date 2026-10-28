# Solana Perps and Prediction Markets hackathon: plan

Hackathon: https://hackathons.solana.com/hackathons/perps-and-prediction-markets
Deadline 5 December 2026. Main track $50k / $30k / $20k (Solana Foundation, judged across all
submissions). Sponsor bounty: best use of pm-AMM ($1k investment from PREDICTSpark). Registered
as @greyat_labs on 30 September. On 28 October: 515 registered, 0 submissions.

## The entry: Sonar Graduation Markets

Prediction markets on one question per token launch: does this Meteora DBC curve graduate
before a date? Priced continuously by pm-AMM, resolved by nobody's say-so.

pm-AMM's own MAINNET.md lists its first accepted risk as centralized resolution: whoever holds
the market authority picks the winner. Sonar already reads the DBC pool account directly and
decides graduation on chain (`curve_market`, `decide`). The new program puts the two together.

### `grad_resolver` program (new, `onchain/programs/grad_resolver`)

- `open_market(pool, config, deadline, initial_price_bps, seed_amount)`: checks the DBC pool
  and config with the same readers as `curve_market` (owner, discriminator, layout, config
  tie, pool not complete), then CPIs pm-AMM `initialize_market` with a program PDA as
  `authority` and `end_ts = deadline`, and seeds liquidity from the PDA's own treasury via
  `deposit_liquidity`. Stores a `Binding { pool, config, pm_market, deadline, threshold }`.
- `halt()`: permissionless. If `decide()` says the outcome is known (the curve
  completed, or the deadline passed), withdraws the PDA's whole LP position. pm-AMM refuses
  swaps once `l_zero` is zero, so trading stops the moment the answer is public. This is the
  AMM form of the bug KupiaSec reported in `curve_market` (stakes after graduation).
- `resolve()`: permissionless, after `end_ts`, and only once halted (pm-AMM refuses LP
  withdrawals after resolution). Reads the pool again and CPIs `resolve_market` signed by the
  PDA with the side `decide()` returns.
- `settle()`: permissionless, after resolution. Claims the PDA's winning outcome tokens and sends
  all of its collateral (winnings plus creator fees) to the opener.
- The PDA is the market creator, so it receives the creator half of pm-AMM's 2% swap fee. That
  is the business model: protocol-owned liquidity that earns fees and cannot be rugged by a
  resolver key.

Residual risk, stated plainly: a trade landing in the same block as the swap that graduates the
pool, before the halt crank. The trader pays for the graduating swap; the keeper bot calls
`halt` on the pool's next account change.

### Status (28 October)

`onchain/programs/grad_resolver` builds and its 12 LiteSVM tests pass against the real pm-AMM and
Metaplex binaries (`onchain/scripts/fetch-test-programs.sh` dumps them from mainnet; pm-AMM's
mainnet build is the devnet build). Covered: the pm-AMM market is created with the binding PDA as
authority and seeded; a trader can buy before graduation and the PDA earns the creator fee;
`halt` is refused while the question is open, works on each completion signal and after the
deadline, and afterwards pm-AMM refuses a 900-unit informed YES buy with `InsufficientLiquidity`;
`resolve` waits for pm-AMM's `end_ts`, then resolves YES or NO from the pool; foreign pools and
markets are refused; `settle` returns the LP and the creator fees to the opener (the whole seed,
less pm-AMM's rounding dust, when nobody traded); every pm-AMM offset and discriminator is
checked against its IDL.

pm-AMM is called by hand-built instructions (`src/pm.rs`), not `declare_program!`: the workspace
pins `anchor-lang` 1.0.2 while the macro crates resolve to 1.2.1, and the generated CPI client
references a type 1.0.2 lacks. Bumping Anchor would change the deployed `curve_market` build.

Costs: `open_market` uses about 660k compute units (pm-AMM's first deposit alone is over 400k),
so clients must request a 1.4M budget; it moves 0.06 SOL to the market's PDA for pm-AMM's rent.
`halt` about 95k, `resolve` about 18k, `settle` about 89k.

**Live on devnet (28 October):** `grad_resolver` deployed at
`73G7X9FKEgTtNQMBWGsCGZfHHBpvVxsJ9kqvV6mvubJH` (upgrade authority FHj8w7…). First market:
binding `Bk47WNJxxoXJWtbnNSjhRpNprrFUTAtfbqKSK1qJa7Vi`, pm-AMM market
`FwBiXLzAsfPBoqRGMMk97tVpUPGYgURkfnnNRc2butCw`, on DBC pool `23gLA7…` (99.6% of its threshold
when opened), 100 mUSDC seed, deadline 19:02 UTC. A 5 mUSDC YES buy went through pm-AMM and
paid the PDA 0.05 mUSDC of creator fee; `halt` answered `NotYet` while the pool was open.

`scripts/grad-market-devnet.ts` drives it: `find` (open pools from the recent DBC tape), `open`,
`show`, `buy`, `halt`, `resolve`, `settle`, and `keep` (crank whatever is due on every market).
The RPC comes from `SOLANA_DEVNET_RPC` in `.env.local` (an Alchemy devnet key); the public
endpoints rate-limit program deploys.

Keeper: `.github/workflows/grad-keeper.yml` runs `keep` every 10 minutes from `main` with a
separate keeper wallet (`9gjTFjRFxoQtzt3z5xb6YFMMnc9yBEJ5HGuPB1Lknqsn`, 0.5 devnet SOL). Repo
secrets: `GRAD_KEEPER_KEYPAIR` (the keypair JSON) and `SOLANA_DEVNET_RPC`.

Not done yet: web.

### Off chain (existing Sonar pieces)

- Sonar Curve already decodes the DBC tape and measures distance to graduation. It picks which
  launches get a market (enough momentum to be a real question) and shows the signal next to
  the price.
- A keeper (GitHub Actions or the Render process) opens markets, cranks `halt` and
  `resolve`.
- `/curve` pool page: pm-AMM price, trade box (SDK `@pm-amm/sdk`), LP warning, halt and
  resolution state.

### Traction (judged most heavily for the bounty)

Everything runs on devnet with the pm-AMM faucet (1,000 mUSDC + 0.2 SOL per wallet), so testers
pay nothing and no real money is involved. Get real wallets trading: Superteam NG community,
X posts, a "first 50 traders" leaderboard. Report users, trades, volume and fees from chain.

## Schedule

| Week | Work |
| --- | --- |
| 28 Oct to 2 Nov | `curve_market` stake fix live on devnet. `grad_resolver` program + LiteSVM tests with the real pm-AMM `.so` |
| 3 to 9 Nov | Deploy to devnet, keeper, first live markets |
| 10 to 16 Nov | Web: pool page trading + LP + state; leaderboard |
| 17 to 30 Nov | Traction push, weekly X updates, fixes from testers |
| 1 to 5 Dec | Demo video, write-up, submit |
