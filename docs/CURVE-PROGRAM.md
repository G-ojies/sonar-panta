# Sonar Curve: the `curve_market` program

Parimutuel YES/NO markets on one question: will a Meteora Dynamic Bonding Curve (DBC) pool finish its curve at or before a deadline? Traders stake the pool's own quote token (wrapped SOL or USDC in practice) on a side. When the market resolves, the winning side splits the losing side pro rata. Resolution reads the DBC pool account itself, so there is no oracle, no admin key, no fee and no pause switch.

| Item | Value |
| --- | --- |
| Program id (devnet) | `DPsFa2nxH568WZdeAgmdaxBrS3Je4UK4K7axxzCYAqjp` |
| DBC program id (devnet and mainnet) | `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN` |
| Source | `onchain/programs/curve_market/` |
| Framework | Anchor 1.0.2 (CLI 1.0.1), solana-cli 3.1.14, platform-tools v1.52 |
| Binary | 264,064 bytes (`opt-level = "z"`) |
| Tests | 45 (`cd onchain && cargo test`), LiteSVM, no network |

## How the DBC pool is read

The program never deserialises a whole DBC account. It checks the owner, the 8-byte discriminator and the minimum length, then reads a handful of fields at fixed offsets. The offsets come from the official IDL at `onchain/dbc-idl.json` (program version 0.2.1) and were checked against live pool accounts on devnet and mainnet.

`VirtualPool` (424 bytes, discriminator `[213,224,5,209,98,69,119,92]`), absolute offsets including the discriminator:

| Field | Offset | Size | Used for |
| --- | --- | --- | --- |
| `config` | 72 | 32 | must equal the `config` account passed in |
| `quote_reserve` | 240 | 8 | compared with `migration_quote_threshold` |
| `is_migrated` | 305 | 1 | 1 once the pool has moved to DAMM |
| `finish_curve_timestamp` | 344 | 8 | unix time the curve completed, 0 while open |

`PoolConfig` (1,048 bytes, discriminator `[26,108,14,123,116,230,129,43]`):

| Field | Offset | Size | Used for |
| --- | --- | --- | --- |
| `quote_mint` | 8 | 32 | must equal the `quote_mint` account passed in |
| `migration_quote_threshold` | 264 | 8 | the quote amount that completes the curve |

`tests/layout.rs` rebuilds both layouts from the IDL JSON at test time and asserts every constant in `src/dbc.rs`, so a DBC upgrade that moves a field fails CI before it can mis-resolve a market.

## Accounts and seeds

| Account | Seeds | Owner | Size | Notes |
| --- | --- | --- | --- | --- |
| `Market` | `["market", pool, deadline_ts as i64 LE]` | program | 251 bytes | one per pool and deadline, so a pool can have many markets |
| vault | `["vault", market]` | token program | 165 bytes | token account for the quote mint, authority is the `Market` PDA |
| `Position` | `["position", market, user]` | program | 90 bytes | one per trader per market, closed on claim |

`Market` fields: `pool`, `config`, `quote_mint`, `token_program`, `vault`, `creator`, `deadline_ts`, `migration_quote_threshold` (copied at creation for display), `yes_total`, `no_total`, `paid_out`, `state`, `resolved_at`, `bump`, `vault_bump`.

`Position` fields: `market`, `owner`, `yes_amount`, `no_amount`, `claimed`, `bump`.

All PDAs are re-derived from stored bumps on every instruction. The creator is recorded but holds no rights.

## Instructions

### `create_market(deadline_ts: i64)`

Accounts: `creator` (signer, pays rent), `pool` (DBC `VirtualPool`), `config` (DBC `PoolConfig`), `quote_mint`, `market` (init), `vault` (init), `token_program`, `system_program`.

Checks, in order: deadline is after the clock and at most 180 days ahead; `pool` is owned by the DBC program, carries the `VirtualPool` discriminator and is at least 424 bytes; `config` equals `pool.config`, is owned by the DBC program and carries the `PoolConfig` discriminator; `quote_mint` equals `config.quote_mint` and is owned by `token_program`; the pool is not already complete (`is_migrated == 0`, `finish_curve_timestamp == 0`, `quote_reserve < migration_quote_threshold`).

Emits `MarketCreated`.

### `stake(side: Side, amount: u64)`

Accounts: `user` (signer), `market`, `position` (init if needed), `quote_mint`, `user_token` (owned by `user`, same mint), `vault`, `token_program`, `system_program`.

Rejected if the market is not `Open`, if the clock is past the deadline, or if `amount` is below `MIN_STAKE` (1,000,000 base units: 0.001 SOL or 1 USDC). The transfer uses `transfer_checked`. The amount credited is the vault balance after minus before, not the requested amount, so a Token-2022 transfer fee reduces the stake instead of inflating a claim.

Emits `Staked`.

### `resolve()`

Accounts: `market`, `pool` (must equal `market.pool`), `config` (must equal `market.config`). No signer beyond the fee payer; anyone may call it once.

Decision, with `now` from the clock sysvar:

1. If `finish_curve_timestamp > 0`: YES when it is at or before the deadline, otherwise NO. This is the authoritative time the curve completed and wins over every other signal, including `is_migrated`.
2. Else if `is_migrated == 1`: YES. Only pools older than the timestamp field can reach this branch.
3. Else if `quote_reserve >= migration_quote_threshold` and `now <= deadline`: YES. The curve is complete now, so it completed in time.
4. Else if `now > deadline`: NO.
5. Else the instruction fails with `NotYet` and the market stays open.

If either side has zero stake the market becomes `Refund` instead of `ResolvedYes` or `ResolvedNo`. Emits `Resolved` with the pool fields it read.

### `claim()`

Accounts: `user` (signer), `market`, `position` (closed to `user`), `quote_mint`, `user_token` (same mint, any owner the user chooses), `vault`, `token_program`.

Rejected while the market is `Open`. Payout by state:

| State | Payout |
| --- | --- |
| `ResolvedYes` | `yes_amount * (yes_total + no_total) / yes_total` |
| `ResolvedNo` | `no_amount * (yes_total + no_total) / no_total` |
| `Refund` | `yes_amount + no_amount` |

The product is computed in u128 and floored. Losers get a payout of zero and still get their position rent back. The position account is closed, so a second claim fails because the account no longer exists. Emits `Claimed`.

## State machine

```
            create_market
                 |
                 v
              [Open] --stake (until deadline)--> [Open]
                 |
      resolve, both sides staked         resolve, a side is empty
        |                 |                        |
        v                 v                        v
  [ResolvedYes]     [ResolvedNo]               [Refund]
        \                 |                        /
         \---------- claim (per position) --------/
```

`Open` is the only state that accepts `stake`. `resolve` moves out of `Open` exactly once. The three terminal states accept `claim` only.

## Invariants

These must hold on every account at every point. The tests check each one.

1. `vault.amount >= yes_total + no_total - paid_out` while any position is unclaimed. Deposits are measured, payouts are floored, so the vault can only hold dust more than it owes, never less.
2. `yes_total + no_total` fits in a u64 (checked on every stake) and is the sum of every live and claimed position on the market.
3. Sum of all payouts on a resolved market is at most `yes_total + no_total`; on a `Refund` market it equals it.
4. A position pays out at most once. The account is closed on claim and `claimed` is set before any transfer.
5. `market.state` changes only in `resolve`, only from `Open`, and only when the decision function returns a side.
6. A YES resolution implies the chain recorded curve completion at or before the deadline (by timestamp) or showed the curve complete while the clock was at or before the deadline.
7. A NO resolution implies the clock was past the deadline and the pool showed no completion in time.
8. Every account an instruction touches is a PDA of this program, the quote mint, a token account of that mint, or a DBC account that passed the owner and discriminator checks.
9. No lamports or tokens leave the program except through `claim`, and only to the account the position owner names.

## Threat model

**Foreign account reads.** The pool and config are not this program's accounts, so an attacker could pass any account. The program requires the DBC program id as owner, the exact discriminator and the minimum length, and ties `config` to `pool.config` and `quote_mint` to `config.quote_mint`. After creation, `resolve` only accepts the exact `pool` and `config` keys stored in the market. An attacker cannot forge a DBC-owned account. A DBC program upgrade that changes the layout is the residual risk; the IDL-pinned tests catch it for a redeploy, and a market created against a pool whose layout changed under it would read garbage. The 180 day cap bounds that exposure.

**Clock.** `Clock::get()` is validator time and can drift by a few seconds. Deadlines are compared with it in `create_market`, `stake` and `resolve`. The curve completion time comes from `finish_curve_timestamp`, which the DBC program wrote from the same clock, so YES versus NO at the boundary is consistent within the chain's own clock. Traders should treat the last minute before a deadline as uncertain.

**Front-running `resolve`.** The common 11.51 SOL SOL-quoted config can fill in minutes once a curve is close. Near the deadline a trader holding YES can push the final swap through the DBC and then resolve YES in the same slot; a NO holder cannot stop that except by resolving NO first, which only works once the clock passes the deadline. This is not an exploit of the program, it is the market pricing a race, but it means a deadline minutes away from a near-complete curve is a bad market to join. `resolve` reads the pool in the same transaction, so the order of a last swap and a resolve inside one slot is decided by the leader. Branch 1 of the decision is unaffected by ordering: once `finish_curve_timestamp` is set the result is fixed by that number, not by who resolved.

**Griefing by creating markets.** Anyone can open a market on any pool at any deadline and pays about 0.0034 SOL of rent for it. A flood of markets costs the creator, not traders, and no market can be forced to accept a stake. The front end should list markets by stake, not by creation.

**Token-2022.** Transfer fees are handled by crediting what the vault received. A mint with a transfer hook needs extra accounts that `transfer_checked` here does not pass, so the first stake on such a market fails and nothing enters the vault. Mints with the permanent delegate extension are out of scope: the delegate could pull tokens out of the vault, so no market should be opened on one. The DBC only quotes in a short list of mints today (SOL and USDC), which keeps this a future concern.

**Rounding.** Payouts floor in u128. The sum of floors is at most the pool, so the vault never goes short. The dust left in a vault is at most one base unit per winning position and stays there; there is no sweep in v1.

**Resolution with one side empty.** Resolves to `Refund` so a single YES trader on a graduating pool cannot win their own stake back as a "profit" and a lone NO trader cannot be left with nothing to claim against.

**Re-initialisation.** `Position` uses `init_if_needed`. The owner and market fields are only written when the account is fresh (`owner == default`), and the PDA seeds already bind it to one market and one user, so an existing position cannot be re-pointed.

**Upgrade authority.** The devnet deployment is upgradeable by the deployer wallet. Before a mainnet launch with real stakes the authority should be burned or moved to a multisig; see the roadmap.

**Out of scope for v1.** Sweeping dust from a vault; closing a resolved market to reclaim rent; partial withdrawals before resolution; markets quoted in a token other than the pool's quote mint; a creator fee or protocol fee; DAMM v2 side questions such as "will it reach X market cap"; a keeper that resolves automatically.

## Test map

All tests live in `onchain/programs/curve_market/tests/` and run on the host over LiteSVM with crafted DBC accounts. The crafted accounts are built with the DBC program id as owner and the real discriminators.

| Area | Test | File |
| --- | --- | --- |
| IDL offsets | `virtual_pool_offsets_match_idl`, `pool_config_offsets_match_idl`, `account_lengths_match_idl`, `discriminators_match_idl`, `dbc_program_id_matches_idl` | `layout.rs` |
| Parser against an IDL-built buffer | `parse_pool_reads_fields_laid_out_by_idl`, `parse_config_reads_fields_laid_out_by_idl`, `parse_rejects_bad_discriminator_and_short_buffers` | `layout.rs` |
| Decision function | `decide_timestamp_is_authoritative`, `decide_migrated_without_timestamp_is_yes`, `decide_threshold_reached_only_counts_before_deadline`, `decide_waits_then_resolves_no` | `layout.rs` |
| Payout math | `payout_even_sides_doubles`, `payout_uneven_sides_floors_and_never_exceeds_pool`, `payout_handles_u64_scale_without_overflow`, `payout_rejects_zero_winning_total_for_nonzero_stake` | `layout.rs` |
| Create | `create_market_stores_fields`, `create_market_allows_several_deadlines_per_pool`, `create_rejects_pool_with_wrong_owner`, `create_rejects_pool_with_wrong_discriminator`, `create_rejects_short_pool_account`, `create_rejects_migrated_or_finished_pool`, `create_rejects_config_and_mint_mismatch`, `create_rejects_bad_deadlines`, `create_rejects_mint_owned_by_other_token_program` | `market.rs` |
| Stake | `stake_both_sides_moves_tokens_and_updates_totals`, `stake_rejects_dust_and_insufficient_balance`, `stake_rejects_after_deadline`, `stake_rejects_wrong_vault_or_mint`, `stake_rejects_after_resolve` | `market.rs` |
| Resolve | `resolve_not_yet_before_deadline`, `resolve_yes_via_is_migrated`, `resolve_yes_via_finish_curve_timestamp`, `resolve_yes_via_quote_reserve_at_threshold_before_deadline`, `resolve_no_after_deadline`, `resolve_no_when_curve_finished_after_deadline`, `resolve_rejects_foreign_pool_or_config` | `market.rs` |
| Claim | `claim_even_sides_pays_winner_double_and_loser_nothing`, `claim_uneven_sides_is_pro_rata_and_never_overpays`, `claim_single_winner_takes_whole_pool`, `claim_refund_returns_both_sides`, `claim_refund_when_only_losers_exist`, `claim_rejects_double_claim`, `claim_rejects_before_resolution_and_other_users_position` | `market.rs` |
| Token-2022 | `token_2022_quote_mint_round_trip` | `market.rs` |

Run them with:

```
cd onchain
anchor build          # or: cargo build-sbf
cargo test            # 45 tests, about two seconds once compiled
CURVE_CU=1 cargo test --test market -- --nocapture   # also prints compute units
```

Compute units per instruction on the `z` build: create about 33k, stake about 38k to 41k, resolve about 9k, claim about 21k to 31k.

## Deploy

```
cd onchain
anchor build
anchor keys list                       # must print DPsFa2nxH568WZdeAgmdaxBrS3Je4UK4K7axxzCYAqjp
solana config set -u devnet
solana program deploy target/deploy/curve_market.so \
  --program-id target/deploy/curve_market-keypair.json --use-rpc
solana program show DPsFa2nxH568WZdeAgmdaxBrS3Je4UK4K7axxzCYAqjp -u devnet
```

`--use-rpc` matters on the public devnet endpoint; TPU writes from this machine time out. If a deploy dies part way, the write buffer keeps its rent: `solana program show --buffers` lists it and `solana program deploy ... --buffer <address>` resumes from it (the wallet is the buffer authority). `solana program close --buffers` reclaims one you no longer need.

The program keypair lives in `onchain/target/deploy/curve_market-keypair.json` and is not committed. It is only needed for the first deploy; upgrades use the wallet as upgrade authority.

## Mainnet rent estimate

From the built binary (264,064 bytes) and `solana rent` on mainnet:

| Account | Bytes | Rent |
| --- | --- | --- |
| Program data | 264,064 + 45 header | 1.3421 SOL |
| Program | 36 | 0.0008 SOL |
| Deploy fees (about 260 write transactions) | | about 0.002 SOL |
| **Total to deploy** | | **about 1.35 SOL** |

Per market, paid by the creator: `Market` 0.0019 SOL plus vault 0.0015 SOL, about 0.0034 SOL. Per position, paid by the trader and returned on claim: 0.0011 SOL.

Upgrading in place is free as long as the new binary is not larger than 264,064 bytes; a larger one needs `solana program extend` at 0.0000051 SOL per extra byte.

## Roadmap to mainnet

1. Burn or move the upgrade authority to a multisig once the program has run on devnet with real DBC pools for a week.
2. Add a `sweep_dust` and `close_market` pair so creators can recover vault and market rent after every position is claimed.
3. Support transfer-hook mints by passing the hook's extra accounts through `remaining_accounts`.
4. A keeper that calls `resolve` the moment `finish_curve_timestamp` is set, so winners do not have to race.
