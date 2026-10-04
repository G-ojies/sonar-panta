# Sonar Curve: the `curve_market` program

Parimutuel YES/NO markets on one question: will a Meteora Dynamic Bonding Curve (DBC) pool finish its curve at or before a deadline? Traders stake the pool's own quote token (wrapped SOL or USDC in practice) on a side. When the market resolves, the winning side splits the losing side pro rata. Resolution reads the DBC pool account itself, so there is no oracle, no admin key, no fee and no pause switch.

| Item | Value |
| --- | --- |
| Program id (devnet) | `DPsFa2nxH568WZdeAgmdaxBrS3Je4UK4K7axxzCYAqjp` |
| DBC program id (devnet and mainnet) | `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN` |
| Source | `onchain/programs/curve_market/` |
| Framework | Anchor 1.0.2 (CLI 1.0.1), solana-cli 3.1.14, platform-tools v1.52 |
| Binary | 265,480 bytes (`opt-level = "z"`); the devnet deployment is the 264,064-byte build from before transfer-hook pools, see [Deploy](#deploy) |
| Tests | 72 (`cd onchain && cargo test`), LiteSVM, no network |

## How the DBC pool is read

The program never deserialises a whole DBC account. It checks the owner, the 8-byte discriminator and the minimum length, then reads a handful of fields at fixed offsets. The offsets come from the official IDL at `onchain/dbc-idl.json` (program version 0.2.1) and were checked against live pool accounts on devnet and mainnet.

A DBC pool is one of two kinds, and the program accepts both:

| Kind (`dbc::PoolKind`) | Pool account | Discriminator | Bytes | Config account | Discriminator | Bytes |
| --- | --- | --- | --- | --- | --- | --- |
| `Virtual` | `VirtualPool` | `[213,224,5,209,98,69,119,92]` | 424 | `PoolConfig` | `[26,108,14,123,116,230,129,43]` | 1,048 |
| `TransferHook` | `TransferHookPool` | `[237,219,184,23,42,189,169,35]` | 424 | `ConfigWithTransferHook` | `[40,220,194,251,41,199,123,253]` | 1,128 |

A `TransferHookPool` is a launch whose base mint is a Token-2022 mint with a transfer hook. Both pool accounts wrap the same `PoolState`, so the pool offsets below serve both. `ConfigWithTransferHook` is a whole `PoolConfig` (its first field, at the same offsets) followed by `transfer_hook_program` (32 bytes at 1,048) and `[u64; 6]` of padding, so the config offsets serve both too. `parse_pool` and `parse_config` choose the kind from the discriminator and refuse every other discriminator, then require the length of that kind. The DBC only creates a `TransferHookPool` under a `ConfigWithTransferHook` and a `VirtualPool` under a `PoolConfig`, and `read_pool_and_config` requires the pool's and the config's kinds to match.

The market only ever stakes the pool's quote token (SOL or USDC in practice); the base mint and its hook are never touched, so a transfer-hook pool needs nothing more than reading its accounts.

Pool offsets (both kinds), absolute including the discriminator:

| Field | Offset | Size | Used for |
| --- | --- | --- | --- |
| `config` | 72 | 32 | must equal the `config` account passed in |
| `quote_reserve` | 240 | 8 | compared with `migration_quote_threshold` |
| `is_migrated` | 305 | 1 | 1 once the pool has moved to DAMM |
| `finish_curve_timestamp` | 344 | 8 | unix time the curve completed, 0 while open |

Config offsets (`PoolConfig`, and the `PoolConfig` inside `ConfigWithTransferHook`):

| Field | Offset | Size | Used for |
| --- | --- | --- | --- |
| `quote_mint` | 8 | 32 | must equal the `quote_mint` account passed in |
| `migration_quote_threshold` | 264 | 8 | the quote amount that completes the curve |

`tests/layout.rs` rebuilds the four layouts from the IDL JSON at test time and asserts every constant in `src/dbc.rs` (for `ConfigWithTransferHook` through its nested `config` field), so a DBC upgrade that moves a field fails CI before it can mis-resolve a market. It also parses two real mainnet `TransferHookPool`s and their configs, kept as hex in `tests/fixtures/transfer_hook_pools.json`.

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

Accounts: `creator` (signer, pays rent), `pool` (DBC `VirtualPool` or `TransferHookPool`), `config` (DBC `PoolConfig` or `ConfigWithTransferHook`), `quote_mint`, `market` (init), `vault` (init), `token_program`, `system_program`.

Checks, in order: deadline is after the clock and at most 180 days ahead; `pool` is owned by the DBC program, carries the `VirtualPool` or `TransferHookPool` discriminator and is at least 424 bytes; `config` equals `pool.config`, is owned by the DBC program, carries the `PoolConfig` or `ConfigWithTransferHook` discriminator and is at least that kind's length (1,048 or 1,128 bytes); the pool and the config are the same kind (`PoolKindMismatch` otherwise); `quote_mint` equals `config.quote_mint` and is owned by `token_program`; the pool is not already complete (`is_migrated == 0`, `finish_curve_timestamp == 0`, `quote_reserve < migration_quote_threshold`).

Emits `MarketCreated`.

### `stake(side: Side, amount: u64)`

Accounts: `user` (signer), `market`, `position` (init if needed), `quote_mint`, `user_token` (owned by `user`, same mint), `vault`, `token_program`, `system_program`.

Rejected if the market is not `Open`, if the clock is past the deadline, or if `amount` is below `MIN_STAKE` (1,000,000 base units: 0.001 SOL or 1 USDC). The transfer uses `transfer_checked`. The amount credited is the vault balance after minus before, not the requested amount, so a Token-2022 transfer fee reduces the stake instead of inflating a claim.

Emits `Staked`.

### `resolve()`

Accounts: `market`, `pool` (must equal `market.pool`), `config` (must equal `market.config`). No signer beyond the fee payer; anyone may call it once. The pool and config go through the same owner, discriminator, length, `pool.config` and kind checks as in `create_market`, so a market resolves the same way on either pool kind.

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
8. Every account an instruction touches is a PDA of this program, the quote mint, a token account of that mint, or a DBC account that passed the owner and discriminator checks. A DBC pool and config read together are of the same kind (`VirtualPool` with `PoolConfig`, `TransferHookPool` with `ConfigWithTransferHook`).
9. No lamports or tokens leave the program except through `claim`, and only to the account the position owner names.

## Threat model

**Foreign account reads.** The pool and config are not this program's accounts, so an attacker could pass any account. The program requires the DBC program id as owner, one of the two pool discriminators (or one of the two config discriminators) and that kind's minimum length, ties `config` to `pool.config` and `quote_mint` to `config.quote_mint`, and requires the pool and config kinds to match. After creation, `resolve` only accepts the exact `pool` and `config` keys stored in the market. An attacker cannot forge a DBC-owned account. A DBC program upgrade that changes the layout is the residual risk; the IDL-pinned tests catch it for a redeploy, and a market created against a pool whose layout changed under it would read garbage. The 180 day cap bounds that exposure.

**Two pool kinds.** Accepting `TransferHookPool` widens what a DBC-owned account may be, so the checks stay exact rather than loose: the discriminator must be one of the two pool discriminators (no other DBC account, such as a config, metadata or operator account, passes; `parse_rejects_every_other_dbc_account` walks every account type in the IDL), the length is checked per kind, and a pool and config of different kinds are refused with `PoolKindMismatch` even though the DBC never creates such a pair, so a config of one kind can never be read through a pool of the other. The fields read are the same `PoolState` and `PoolConfig` bytes in both kinds, pinned against the IDL for each. The base mint's transfer hook is irrelevant to the market: stakes and payouts move the quote mint only, and the hook runs only when the base token moves, inside the DBC. The pool kind is not stored in the `Market` (the account layout is unchanged); `resolve` reads it again from the discriminator, which the DBC never changes for an existing account.

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

All tests live in `onchain/programs/curve_market/tests/` and run on the host over LiteSVM with crafted DBC accounts. The crafted accounts are built with the DBC program id as owner and the real discriminators. The lifecycle tests run once per pool kind through a `both_kinds!` macro: the plain name is the `VirtualPool` run, the `transfer_hook_` name the `TransferHookPool` one.

| Area | Test | File |
| --- | --- | --- |
| IDL offsets | `virtual_pool_offsets_match_idl` (both pool kinds), `pool_config_offsets_match_idl` (also inside `ConfigWithTransferHook`), `account_lengths_match_idl`, `discriminators_match_idl`, `dbc_program_id_matches_idl` | `layout.rs` |
| Parser against an IDL-built buffer | `parse_pool_reads_fields_laid_out_by_idl`, `parse_transfer_hook_pool_reads_fields_laid_out_by_idl`, `parse_config_reads_fields_laid_out_by_idl`, `parse_config_with_transfer_hook_reads_fields_laid_out_by_idl`, `parse_rejects_bad_discriminator_and_short_buffers`, `parse_transfer_hook_kinds_reject_bad_discriminator_and_short_buffers`, `parse_rejects_every_other_dbc_account` | `layout.rs` |
| Parser against real accounts | `parse_real_transfer_hook_pool_snapshots` (two mainnet `TransferHookPool`s and their `ConfigWithTransferHook`s) | `layout.rs` |
| Decision function | `decide_timestamp_is_authoritative`, `decide_migrated_without_timestamp_is_yes`, `decide_threshold_reached_only_counts_before_deadline`, `decide_waits_then_resolves_no` | `layout.rs` |
| Payout math | `payout_even_sides_doubles`, `payout_uneven_sides_floors_and_never_exceeds_pool`, `payout_handles_u64_scale_without_overflow`, `payout_rejects_zero_winning_total_for_nonzero_stake` | `layout.rs` |
| Create | `create_market_stores_fields`, `create_market_allows_several_deadlines_per_pool`, `create_rejects_pool_with_wrong_owner`, `create_rejects_pool_with_wrong_discriminator`, `create_rejects_short_pool_account`, `create_rejects_migrated_or_finished_pool`, `create_rejects_config_and_mint_mismatch`, `create_rejects_bad_deadlines`, `create_rejects_mint_owned_by_other_token_program` | `market.rs` |
| Stake | `stake_both_sides_moves_tokens_and_updates_totals`, `stake_rejects_dust_and_insufficient_balance`, `stake_rejects_after_deadline`, `stake_rejects_wrong_vault_or_mint`, `stake_rejects_after_resolve` | `market.rs` |
| Resolve | `resolve_not_yet_before_deadline`, `resolve_yes_via_is_migrated`, `resolve_yes_via_finish_curve_timestamp`, `resolve_yes_via_quote_reserve_at_threshold_before_deadline`, `resolve_no_after_deadline`, `resolve_no_when_curve_finished_after_deadline`, `resolve_rejects_foreign_pool_or_config` | `market.rs` |
| Claim | `claim_even_sides_pays_winner_double_and_loser_nothing`, `claim_uneven_sides_is_pro_rata_and_never_overpays`, `claim_single_winner_takes_whole_pool`, `claim_refund_returns_both_sides`, `claim_pays_trader_holding_both_sides`, `claim_rejects_double_claim`, `claim_rejects_before_resolution_and_other_users_position` | `market.rs` |
| Token-2022 | `token_2022_quote_mint_round_trip` | `market.rs` |
| `TransferHookPool` mirror | the same body as the `VirtualPool` test, over a `TransferHookPool` under a `ConfigWithTransferHook`: `transfer_hook_create_market_stores_fields`, `transfer_hook_create_rejects_pool_with_wrong_owner`, `transfer_hook_create_rejects_pool_with_wrong_discriminator`, `transfer_hook_create_rejects_short_pool_account`, `transfer_hook_create_rejects_migrated_or_finished_pool`, `transfer_hook_create_rejects_config_and_mint_mismatch`, `transfer_hook_stake_both_sides_moves_tokens_and_updates_totals`, `transfer_hook_resolve_not_yet_before_deadline`, `transfer_hook_resolve_yes_via_is_migrated`, `transfer_hook_resolve_yes_via_finish_curve_timestamp`, `transfer_hook_resolve_yes_via_quote_reserve_at_threshold_before_deadline`, `transfer_hook_resolve_no_after_deadline`, `transfer_hook_resolve_no_when_curve_finished_after_deadline`, `transfer_hook_resolve_rejects_foreign_pool_or_config`, `transfer_hook_claim_even_sides_pays_winner_double_and_loser_nothing`, `transfer_hook_claim_refund_returns_both_sides`, `transfer_hook_token_2022_quote_mint_round_trip` | `market.rs` |
| Pool kinds | `create_rejects_pool_and_config_of_different_kinds`, `create_rejects_short_config_with_transfer_hook`, `resolve_rejects_pool_rewritten_to_other_kind`, `markets_on_both_kinds_settle_independently`, `real_transfer_hook_pool_snapshot_opens_and_resolves` (real mainnet bytes: opens on a trading pool, resolves NO after the deadline, refuses a migrated one) | `market.rs` |

Run them with:

```
cd onchain
anchor build          # or: cargo build-sbf
cargo test            # 72 tests, about four seconds once compiled
CURVE_CU=1 cargo test --test market -- --nocapture   # also prints compute units
```

Compute units per instruction on the `z` build: create about 33k to 36k, stake about 38k to 44k, resolve about 9k, claim about 21k to 31k, the same for both pool kinds within a few dozen units (the spread is the PDA bump search).

## Deploy

```
cd onchain
anchor build                           # add --ignore-keys when target/deploy holds no program keypair
anchor keys list                       # must print DPsFa2nxH568WZdeAgmdaxBrS3Je4UK4K7axxzCYAqjp
solana config set -u devnet
solana program deploy target/deploy/curve_market.so \
  --program-id target/deploy/curve_market-keypair.json --use-rpc
solana program show DPsFa2nxH568WZdeAgmdaxBrS3Je4UK4K7axxzCYAqjp -u devnet
```

`--use-rpc` matters on the public devnet endpoint; TPU writes from this machine time out. If a deploy dies part way, the write buffer keeps its rent: `solana program show --buffers` lists it and `solana program deploy ... --buffer <address>` resumes from it (the wallet is the buffer authority). `solana program close --buffers` reclaims one you no longer need.

The program keypair lives in `onchain/target/deploy/curve_market-keypair.json` and is not committed. It is only needed for the first deploy; upgrades use the wallet as upgrade authority. A fresh `target/` gets a new random keypair, which is why `anchor build` then needs `--ignore-keys`; do not run `anchor keys sync`, which would rewrite the program id.

### Upgrade for transfer-hook pools

Done on devnet: the program (`DPsFa2nxH568WZdeAgmdaxBrS3Je4UK4K7axxzCYAqjp`) was extended by 10,240 bytes and upgraded in slot 506,942,309 (program data now 274,304 bytes), and on 4 October 2026 a dump of the deployed program matched the 265,480-byte `TransferHookPool` build byte for byte. The `Market` and `Position` layouts and the instruction set are unchanged, so existing markets keep working after an upgrade and the web client needs no change beyond the error messages it already has. The new build is 265,480 bytes, 1,416 more than the deployed one, so the program data account has to grow. solana-cli 3.1 extends it automatically on deploy; the explicit form is:

```
solana program extend DPsFa2nxH568WZdeAgmdaxBrS3Je4UK4K7axxzCYAqjp 1416 -u devnet   # optional, deploy does it
solana program deploy target/deploy/curve_market.so --program-id DPsFa2nxH568WZdeAgmdaxBrS3Je4UK4K7axxzCYAqjp -u devnet --use-rpc
```

Measured with `solana rent` on devnet on 3 October 2026: the extend costs 0.0072 SOL of rent, kept by the program. The deploy writes the new binary to a buffer first, which needs about 1.349 SOL of rent while it exists; that comes back to the wallet when the upgrade consumes the buffer, so the lasting cost is the extend plus about 0.002 SOL of fees for about 260 write transactions. The authority wallet held 0.217 SOL on that date, so it needs about 1.15 devnet SOL more (a faucet airdrop) before the upgrade can run.

## Mainnet rent estimate

From the built binary (264,064 bytes before transfer-hook pools; 265,480 now adds about 0.0072 SOL) and `solana rent` on mainnet:

| Account | Bytes | Rent |
| --- | --- | --- |
| Program data | 264,064 + 45 header | 1.3421 SOL |
| Program | 36 | 0.0008 SOL |
| Deploy fees (about 260 write transactions) | | about 0.002 SOL |
| **Total to deploy** | | **about 1.35 SOL** |

Per market, paid by the creator: `Market` 0.0019 SOL plus vault 0.0015 SOL, about 0.0034 SOL. Per position, paid by the trader and returned on claim: 0.0011 SOL.

Upgrading in place is free as long as the new binary is not larger than the program data account; a larger one needs `solana program extend` at 0.0000051 SOL per extra byte, as the transfer-hook build does on devnet (above).

## Roadmap to mainnet

1. Burn or move the upgrade authority to a multisig once the program has run on devnet with real DBC pools for a week.
2. Add a `sweep_dust` and `close_market` pair so creators can recover vault and market rent after every position is claimed.
3. Support transfer-hook mints by passing the hook's extra accounts through `remaining_accounts`.
4. A keeper that calls `resolve` the moment `finish_curve_timestamp` is set, so winners do not have to race.
