# Sonar Curve: the Meteora DBC data path

Sonar Curve follows token launches on Meteora's Dynamic Bonding Curve (DBC): the price along each curve, the quote it has raised, how far it is from graduation, and the prints behind that, decoded from the program's own events and accounts. It is served on `/curve` and as JSON for terminals. The on-chain graduation markets (a parimutuel YES/NO on whether a curve graduates before a date, resolved from the pool account itself) are the `curve_market` program, documented in [CURVE-PROGRAM.md](CURVE-PROGRAM.md) and wired into the pool page; see [Graduation markets](#graduation-markets) below. The plan is in [CURVE-PLAN.md](CURVE-PLAN.md).

Nothing here needs an SDK or an indexer. The program's IDL (`src/lib/dbc-idl.json`, program version 0.2.1) is the only source of truth for discriminators and layouts, and the chain is the only source of data, read through the same RPC path as the Panta tape (Solami or RPC Fast when a key is set, the public endpoint otherwise; see [SOLAMI.md](SOLAMI.md)).

## The program

`dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN`, the same id on mainnet and devnet. A launch is a pool account holding a base token and a quote token (SOL or USDC in practice) with a constant-product curve in `sqrt_price` space. Traders buy and sell along it; when the quote the pool holds reaches the config's `migration_quote_threshold`, the curve is complete and the liquidity migrates to a Meteora DAMM v2 pool. That is graduation.

A pool comes in two kinds, and Sonar reads both:

| Kind | Pool account | Config account | Created by | Swapped by |
| --- | --- | --- | --- | --- |
| plain | `VirtualPool` | `PoolConfig` | `initialize_virtual_pool_with_spl_token` / `_with_token2022` | `swap`, `swap2` |
| transfer hook | `TransferHookPool` (a Token-2022 base mint with a transfer hook) | `ConfigWithTransferHook` | `initialize_virtual_pool_with_token2022_transfer_hook` | `swap2_with_transfer_hook` |

Both pool accounts wrap the same `PoolState` and are 424 bytes; `ConfigWithTransferHook` is a whole `PoolConfig` followed by the hook program and padding. So price, progress and graduation read identically for both, and only the discriminators, the config length and the event names differ. The DBC only creates a `TransferHookPool` under a `ConfigWithTransferHook` and a `VirtualPool` under a `PoolConfig`.

On 3 October 2026 the program owned 1,728,254 `VirtualPool` and 2,033 `TransferHookPool` accounts on mainnet, and 85,333 and 1,044 on devnet. By traffic the picture flips on devnet: in a spread sample of 60 recent successful transactions, 45 of 53 swaps on devnet were `swap2_with_transfer_hook`, against 1 of 59 on mainnet.

Measured on 2 October 2026: the program sees about 11 transactions a second, a quarter of them failed (bot swaps that lost a race), and a pool creation is about 0.6 percent of the successful ones (6 in a sample of 1,000). Every creation in that sample was signed and paid by the creator's own wallet, direct to the program, under a different config. Curves with the common 11.51 SOL threshold filled and migrated within minutes of being met.

## How the tape is decoded

### Events come from inner instructions, not the log

The DBC program emits events with Anchor's `emit_cpi!`, not `emit!`. So there is no `Program data:` line to parse, as there is for Panta. Each event is a self-CPI: an inner instruction to the DBC program with the event authority as its one account, whose data is

```
[228,69,165,46,81,203,154,29]   the Anchor event tag, sha256("anchor:event")[..8]
<8-byte event discriminator>    from the IDL, for example EvtSwap2 = [189,66,51,168,38,80,117,153]
<Borsh body>                    the event's fields in IDL order
```

`eventsFromTx` in `src/lib/dbc.ts` walks `meta.innerInstructions`, keeps the instructions addressed to the program that start with the tag, and decodes the rest against the IDL. `Program data:` lines are decoded too, in case a build ever uses `emit!`. A `swap2` instruction emits both the legacy `EvtSwap` and `EvtSwap2`; only `EvtSwap2` becomes a print (it carries the reserve and the threshold after the swap). Transactions are fetched with `maxSupportedTransactionVersion: 1`; the node already serves version 1 transactions.

The transfer-hook instructions emit their own event types, with bodies identical to the plain ones (the tests compare the IDL types field by field). `decodeEvent` reports each under the plain name it mirrors and keeps the IDL's own name in `idlName`, so the index and the tape treat a transfer-hook swap or creation exactly like a plain one:

| IDL event | Read as |
| --- | --- |
| `EvtSwap2WithTransferHook` `[134,59,168,120,94,51,114,231]` | `EvtSwap2` |
| `EvtInitializePoolWithTransferHook` `[213,137,164,53,193,74,15,110]` | `EvtInitializePool` |
| `EvtCurveCompleteWithTransferHook` `[59,47,109,205,13,31,44,159]` | `EvtCurveComplete` |

### Events used

| Event | What Sonar takes from it |
| --- | --- |
| `EvtInitializePool` (or its transfer-hook twin) | pool, config, creator, base mint, activation point: a launch enters the index with its creation time |
| `EvtSwap2` (or `EvtSwap2WithTransferHook`) | pool, trade direction, amounts in and out, `next_sqrt_price`, `quote_reserve_amount`, `migration_threshold`: one print, with price and progress after it |
| `EvtSwap` | the legacy swap, turned into a print only when no `EvtSwap2` came with it (no reserve figures then) |
| `EvtCurveComplete` (or its transfer-hook twin) | decoded and available; the account's `finish_curve_timestamp` says the same thing and is what the status reads |

`trade_direction` 1 is quote to base, a buy; 0 is base to quote, a sell. On a buy the quote that moved is `included_fee_input_amount` (what the trader paid, fee included) and the base is `output_amount`; on a sell the other way round.

### Accounts

All four are bytemuck accounts. Their Rust layouts carry explicit padding so no implicit alignment padding exists, which is what lets the same sequential reader decode them; the sizes the IDL implies match the live accounts exactly.

| Account | Discriminator | Bytes with the discriminator |
| --- | --- | --- |
| `VirtualPool` | `[213,224,5,209,98,69,119,92]` | 424 |
| `TransferHookPool` | `[237,219,184,23,42,189,169,35]` | 424 |
| `PoolConfig` | `[26,108,14,123,116,230,129,43]` | 1,048 |
| `ConfigWithTransferHook` | `[40,220,194,251,41,199,123,253]` | 1,128 |

`decodePool` picks the pool kind by discriminator and returns the `PoolState` with a `kind` (`virtual` or `transferHook`); `decodeConfig` does the same for the two configs and adds `transfer_hook_program` for the hook one. `decodeVirtualPool`, `decodeTransferHookPool` and `decodePoolConfig` stay strict about their one account. Offsets after the discriminator that a program reading the pool needs (`offsetOf` in `dbc.ts` computes them from the IDL). They are the same for both pool kinds, and the config ones are the same inside `ConfigWithTransferHook`, whose `config` field starts at 0; its `transfer_hook_program` is at 1,040.

| Field | Offset | Type |
| --- | --- | --- |
| `pool_state.config` | 64 | pubkey |
| `pool_state.quote_reserve` | 232 | u64 |
| `pool_state.sqrt_price` | 272 | u128 |
| `pool_state.is_migrated` | 297 | u8 |
| `pool_state.finish_curve_timestamp` | 336 | u64 |
| `PoolConfig.quote_mint` | 0 | pubkey |
| `PoolConfig.token_decimal` | 227 | u8 |
| `PoolConfig.migration_quote_threshold` | 256 | u64 |

### Price, progress, status

- **Price.** `sqrt_price` is the square root of the price in Q64.64 fixed point, in raw units (quote lamports per base unit). So `price_raw = (sqrt_price / 2^64)^2`, and the display price in quote per whole token is `price_raw * 10^(base_decimals - quote_decimals)`. Base decimals come from the config's `token_decimal`, quote decimals from the quote mint (SOL 9, USDC 6, anything else read from the mint account once). Checked live on 50 prints across two pools: the price from `next_sqrt_price` agreed with each print's own quote/base ratio within one percent, which also confirms the direction mapping (a swapped direction would invert the ratio).
- **Progress.** `quote_reserve / migration_quote_threshold`, in percent, capped at 100. Sells move it back; a curve can sit under the line for a long time.
- **Status.** `trading` until `finish_curve_timestamp` is set by the swap that fills the curve (`complete`), then `migrated` once `is_migrated` is set and the DAMM pool exists. Both read straight from the account, so a graduation market can resolve with no oracle.
- **Age.** The creation event's block time when the creation was in a sample; otherwise the activation point, exact when the config activates by timestamp and estimated at 0.4 s a slot when it activates by slot (shown with a tilde).

## How pools are found and followed

A signature row says nothing about the instruction behind it, and no account is touched only at creation (the creation instruction's accounts are the config, the pool authority, the creator, the mints, the pool and its vaults, Metaplex and the system program; swaps share the ones that are not new per pool). Reading every transaction to find creations would cost about a megabyte a minute. So the index is sampled and bounded, and the page says so.

1. **Discovery.** Each refresh reads the newest `CURVE_SCAN_SIGNATURES` (100) signatures of the program in one call, then fetches `CURVE_SCAN_TXS` (20) successful transactions spread evenly across them (a burst of bot swaps on one pool would otherwise fill the sample). A creation enters the index with its creator and time. A swap enters its pool too, because a curve that is trading now is what a graduation market is about, and the print joins that pool's tape.
2. **Following.** Every indexed pool's account is read in one `getMultipleAccounts` sweep per refresh (424 bytes each, 100 to a call), which gives price, quote held, progress and status for all of them. A pool's config never changes, so it is read once and cached for a month.
3. **Tapes.** A pool's own signature list holds only its own transactions, so a tape is cheap per pool: `CURVE_TAPES_PER_SCAN` (3) pools a refresh, pinned ones first, then trading pools nearest graduation, at most 25 signatures and `CURVE_TAPE_TXS` (8) transactions each, with a cursor so a fill only reads what is new. Opening a pool page fills its tape on demand when it is older than two minutes, at most `CURVE_ONDEMAND_PER_10MIN` (8) fills per ten minutes per process. Tapes are capped at 200 prints and kept seven days.
4. **Keeping.** The index holds at most `CURVE_INDEX_MAX` (150) pools, ranked by when Sonar last saw them trade. Quiet pools go after `CURVE_KEEP_HOURS` (36); migrated ones a day after their last activity. Addresses listed in the store key `sonar:curve:pinned` are never evicted and always get a tape first: that is where the graduation markets' pools go once the program is wired.
5. **Any pool by address.** `/curve/<address>` and `/api/curve/pool/<address>` read a pool the index has never met live (one account, one config), add it to the index so the next refresh follows it, and fill its tape inside the on-demand budget. A known pool's account is re-read when its row is older than a minute, once a minute at most, because a curve can fill in minutes.

## Cadence and bandwidth

The refresh rides the existing tick (`POST /api/agent`, every 10 minutes from the pinger, a scan every second call) after the Panta work, and runs at most once per `CURVE_MIN_INTERVAL_S` (1,800 s). It never throws into the tick; `SONAR_CURVE=off` disables it. `npm run agent` runs it too.

Measured with `npx tsx scripts/measure-curve.ts` on 2 October 2026 over Solami (which compresses responses with brotli; the wire figure is the JSON size over three):

| Refresh | RPC calls | JSON | On the wire | Time |
| --- | --- | --- | --- | --- |
| cold, 30 sampled transactions, 4 tapes | 55 | 0.46 MB | ~0.15 MB | 14 s |
| warm, 30 sampled, 4 tapes, 5 pools kept | 77 | 0.78 MB | ~0.26 MB | 41 s |
| warm with the defaults (20 sampled, 3 tapes), 7 kept | 40 | 0.41 MB | ~0.14 MB | 10 s |

With the defaults and the half-hour gate: about 48 refreshes a day, about 20 MB of JSON a day, 0.6 GB a month, of which about 0.2 GB crosses the wire. That is around four percent of the Render free plan's 5 GB, beside the Panta scan's few megabytes. Every figure above is a knob; `CURVE_SCAN_TXS=60` would see three times the launches for three times the bytes. The sample itself is the limit: at 0.6 percent, 20 transactions a refresh meet a creation every eight refreshes or so, while swaps put two or three live curves into the index each time. A Yellowstone stream filtered to transactions that carry both the DBC program and the Metaplex metadata program would be a true creation feed, but needs a plan with streaming, which the free Solami key does not have; nothing here subscribes to the program.

The RPC calls are paced to the plan's rate like everything else (4 a second on Solami's free plan), so a refresh takes 10 to 40 seconds, inside the tick's lock.

## API

Both routes are JSON, no auth, shaped for a terminal to poll. Amounts in display units carry their symbol's decimals already applied; raw fields are strings of the chain's integers.

### `GET /api/curve/launches`

Query: `status=trading|complete|migrated`, `limit` (default 100, max 500). Cached 30 s at the edge.

```json
{
  "program": "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN",
  "updatedAt": 1790933240, "slot": 452569401,
  "sample": { "signatures": 100, "transactions": 20, "creations": 0, "prints": 32, "pools": 2 },
  "kept": 7,
  "pools": [{
    "address": "BSTNBGAymY8PfNCMUTnr9y6tdCPZpRnELeN7zxaYUgUa", "kind": "virtual",
    "config": "...", "creator": "...", "baseMint": "...",
    "quote": { "mint": "So11111111111111111111111111111111111111112", "symbol": "SOL", "decimals": 9 }, "baseDecimals": 6,
    "createdAt": 1790933100, "createdFrom": "slot",
    "firstSeenAt": 1790933240, "lastSeenAt": 1790933240, "foundBy": "swap",
    "status": "trading",
    "price": 3.14e-7, "sqrtPrice": "352059356085964233",
    "quoteRaised": 9.31, "quoteReserveRaw": "9310000000", "threshold": 11.51, "thresholdRaw": "11510000000", "progressPct": 80.88,
    "finishCurveAt": null,
    "prints": 24, "buys": 10, "sells": 14, "buyQuote": 3.63,
    "largest": [{ "signature": "...", "side": "sell", "quote": 0.203, "blockTime": 1790933239, "wallet": "..." }],
    "tape": [ "...the last five prints, newest first..." ],
    "updatedAt": 1790933240
  }],
  "errors": [], "lastRefreshes": [{ "ts": 1790933240, "signatures": 100, "transactions": 20, "creations": 0, "prints": 32, "pools": 2, "kept": 7, "errors": 0, "durationMs": 10210 }]
}
```

`kind` is `virtual` for a `VirtualPool` and `transferHook` for a `TransferHookPool`. Rows come trading pools nearest graduation first, then complete, then migrated. `prints` counts what Sonar has decoded for the pool, bounded, not the pool's lifetime count. Before the first refresh the body is `{ "pools": [], "note": "the curve index has not run yet" }`.

### `GET /api/curve/pool/<address>`

Never cached. 400 for a string that is not a public key, 404 for an account that is not a DBC pool of either kind.

```json
{
  "program": "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN",
  "pool": { "...the same row as above, with the account re-read when the row was stale..." },
  "tape": [{
    "id": "38m1ss...", "signature": "38m1ss...", "blockTime": 1790933239, "pool": "...", "wallet": "Bvca7D...",
    "side": "sell", "quoteRaw": "203140223", "baseRaw": "545939648458", "tradingFeeRaw": "407300",
    "sqrtPriceAfter": "354337999572150541", "quoteReserveAfter": "10745917181", "migrationThreshold": "11510000000", "source": "chain"
  }],
  "tapeUpdatedAt": 1790933644, "tapeComplete": false, "fresh": true,
  "markets": { "...the same body /api/curve/markets?pool=<address> returns, or null when that read failed..." }
}
```

`tape` is newest first, up to 200 prints. Price after a print is `(sqrtPriceAfter / 2^64)^2 * 10^(baseDecimals - quote.decimals)`; progress after it is `quoteReserveAfter / migrationThreshold`. `tapeComplete` is true when the pool's whole history fit the bounds. `markets` carries the pool's graduation markets (below).

### `GET /api/curve/markets`

Query: `pool=<address>` for one pool's markets (all of them otherwise), `user=<wallet>` to add that wallet's positions, `fresh=1` to skip the 20 s cache (the page sends it right after a transaction). Never cached at the edge.

```json
{
  "cluster": "devnet", "program": "DPsFa2nxH568WZdeAgmdaxBrS3Je4UK4K7axxzCYAqjp", "live": true, "updatedAt": 1790936488,
  "markets": [{
    "address": "6UP1xah7U3gLNbhaWgHrwap7qr1S6r74xGSCCu8f3xs3", "pool": "HC7QTaRzfQuRDV8irdojM23WDQPaSmruSEnRmjkuqPuf",
    "config": "FAGvfZpCHPmNBSqzUP9EKtQqTsAA3VHRLLuqZuhv1Cu4", "quoteMint": "So11111111111111111111111111111111111111112",
    "tokenProgram": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "vault": "4dYrFaGcwDhviAscTMuUmkeMr2Kp8zzEnmBdbipugtv8",
    "creator": "FHj8w7MuuqMBeEKdFT2BXEEx9Xj6dZ18Z9cLiBmPr513", "deadlineTs": 1790936833, "thresholdRaw": "10000000000",
    "yesTotalRaw": "3000000", "noTotalRaw": "2000000", "paidOutRaw": "0", "state": "open", "resolvedAt": null, "bump": 255, "vaultBump": 254
  }],
  "positions": [{ "address": "EcY7...AUbn", "market": "6UP1...3xs3", "owner": "FHj8...r513", "yesAmountRaw": "3000000", "noAmountRaw": "0", "claimed": false, "bump": 255 }]
}
```

`state` is `open`, `yes`, `no` or `refund`. Raw amounts are strings of the quote token's base units. `live` says whether the app's own cluster is the one the markets run on; when it is false the page shows them read-only. Open markets come first by deadline, then settled ones newest first.

## Pages

- `/curve`: the index as a list, with a status filter, a progress bar per pool, quote raised against the threshold, price, prints seen, the largest print and age. A table on wide screens, cards on phones. A lookup box opens any pool address.
- `/curve/<address>`: price, the graduation progress with what is left to raise, the price path drawn from the tape, the account fields behind graduation (including which pool account it is), the tape, the largest prints, and the graduation market panel. Polls its API every 30 seconds, the markets every 15. A row on `/curve` carries a "1 market" chip when the pool has open markets and "settled" when it only has resolved ones.

## Graduation markets

The `curve_market` program ([CURVE-PROGRAM.md](CURVE-PROGRAM.md)) holds parimutuel YES/NO markets on one question per pool and deadline: does the curve finish at or before the deadline? The web side is `src/lib/curve-market.ts` (PDAs, account decoders, the four instructions and the token instructions around them, read helpers), `src/lib/curve-market-math.ts` (odds, payouts and the program's decision function, mirrored so the page needs neither the IDL nor web3.js), `src/lib/curve-market-server.ts` (the cached reads behind the API) and `src/components/CurveMarketPanel.tsx`. No Anchor client and no SPL token library: the discriminators come from `onchain/idl/curve_market.json` and the tests check them against it.

### Where the markets run

The program is deployed on devnet only; a mainnet deployment is a decision for the owner (about 1.35 SOL of rent, see the program doc). So the markets are always read from devnet, whatever cluster the app is on: `CURVE_MARKET_RPC` when set, else the app's own RPC when the app is on devnet, else the public devnet endpoint. The panel shows a `devnet` pill and enables the actions only when the app's cluster is the markets' cluster (`NEXT_PUBLIC_SOLANA_CLUSTER=devnet`); on mainnet the markets are shown read-only with a note. Pool addresses differ between clusters, so a mainnet pool page lists no markets until the program is on mainnet. The map of program ids per cluster is `CURVE_MARKET_PROGRAMS` in `curve-market.ts`.

### The flow on the pool page

1. **Open a market.** Pick a deadline (1 h, 6 h, 24 h, 7 d, or a date and time, at least a minute and at most 180 days away) and sign `create_market`. The creator pays about 0.0034 SOL of rent for the `Market` account and its vault and gets no fee. The program refuses a pool whose curve is already complete.
2. **Stake.** Pick YES or NO and an amount of the pool's quote token (at least 0.001 SOL or 1 USDC). The buttons show the multiple a win would pay at today's totals. With wrapped SOL the transaction creates the wallet's wSOL token account if it is missing, moves the lamports in, syncs the balance, stakes, and closes the account again when it was created here, so no SOL stays wrapped. With any other quote token the wallet's token account must already hold the amount. A stake is refused once the deadline has passed.
3. **Resolve.** The panel runs the program's decision function on the pool row it already has (`finish_curve_timestamp` first, then `is_migrated`, then `quote_reserve` against the threshold before the deadline, then the deadline itself) and shows a resolve box as soon as it returns a side. Anyone may sign it. One side empty resolves to a refund.
4. **Claim.** Once the market is settled, a wallet with a position sees what it can claim (its stake plus its share of the losing side, its stake back on a refund, or only the position rent on a loss) and signs `claim`. The payout lands in the wallet's token account and wrapped SOL is unwrapped by closing it.

Errors use the IDL's messages (`friendlyProgramError`), a wallet rejection is not an error, and every signature links to Solscan on the right cluster.

### Running it on devnet

```
NEXT_PUBLIC_SOLANA_CLUSTER=devnet NEXT_PUBLIC_SOLANA_RPC=https://api.devnet.solana.com \
SOLANA_RPC=https://api.devnet.solana.com RPCFAST_API_KEY= SOLAMI_API_KEY= \
KV_REST_API_URL= KV_REST_API_TOKEN= SONAR_STORE_FILE=/tmp/sonar-devnet.json npm run dev
```

The empty keys keep the DBC index off the mainnet providers and the scratch store keeps devnet pools out of the production Redis. Run `npx tsx scripts/measure-curve.ts` with the same variables to index devnet pools once; the pools with markets are pinned, so every refresh follows them. Most swaps on devnet are on `TransferHookPool`s, which the index, the pool page and the program source all accept. The devnet deployment of the program predates that support, though: until it is upgraded (see [CURVE-PROGRAM.md](CURVE-PROGRAM.md#deploy)), `create_market` on a `TransferHookPool` fails with error 6001 and the panel says the pool is not a pool the program accepts.

`scripts/curve-market-devnet.ts` drives the program from a keypair file with the same builders the panel uses (`markets`, `create`, `stake`, `resolve`, `claim`, `fund`), which is how the run below was made.

### Verified on devnet

2 October 2026, program `DPsFa2nxH568WZdeAgmdaxBrS3Je4UK4K7axxzCYAqjp`, pool `HC7QTaRzfQuRDV8irdojM23WDQPaSmruSEnRmjkuqPuf` (a SOL curve with a 10 SOL threshold, 0 percent filled), wallet A `FHj8w7MuuqMBeEKdFT2BXEEx9Xj6dZ18Z9cLiBmPr513`, wallet B `DTeo8aoBMJWnGfCn14qAbMVKJhJcN94yLmcdGsadqood` (a throwaway funded from A). Every transaction went through the public devnet endpoint and confirmed on the first send. Links are `https://solscan.io/tx/<signature>?cluster=devnet`.

| Step | Wallet | Signature | Result |
| --- | --- | --- | --- |
| `create_market`, deadline 7 minutes ahead (10:27:13 UTC) | A | `3eBY1purFynymn7vNcsRQNCuvSGeA4tdi1RzY8pQiecNDURS57LK5KgLcsqdkiDGwAnrEpPtCd1kk1Rqapma9WXU` | market `6UP1xah7U3gLNbhaWgHrwap7qr1S6r74xGSCCu8f3xs3`, vault `4dYrFaGcwDhviAscTMuUmkeMr2Kp8zzEnmBdbipugtv8`; 0.0034 SOL of rent |
| fund wallet B with 0.012 SOL | A | `53sPS93DXxCGFmjMYxkMPx5MdQsW4CcAFiNBtRTaQojUPjBeQ5iGZRcP7rhDVDNVVJTCxzn1TDiPYwg97YPa4ooT` | |
| `stake` YES 0.003 SOL (create wSOL ATA, transfer, SyncNative, stake, close ATA in one transaction) | A | `3Kn4vR9aJXzfxgKVzBNtsvFZume1GioSxqM1Q2vgNpV7bZY6C2akPhiJ6CW91tnZRM9cQbJvL7917ofoCyzjQBwJ` | `yes_total` 0.003 |
| `stake` NO 0.002 SOL, same path | B | `3hMKCLx643FpWEZ7vxBSEt8WGFZjGEW7iaFwW4q2wnWVCZiDMGae41C7DBbkj5KkApTzAKSSycbVmYdMHrsquYmF` | `no_total` 0.002 |
| `resolve` before the deadline | A | (simulation refused, nothing sent) | `NotYet` (0x177f), shown as "The pool has not graduated and the deadline has not passed yet" |
| `resolve` after the deadline | A | `5opgjhs82euupaawEyhoYX5XMgFfJ7UGWrJoJTxFzSq6TQWUoJi1gF9hN512Cvq1UCEKZDF2PXUL9CuCnJUgD9zL` | `ResolvedNo`, `resolved_at` 1790936933 |
| `claim` on the winning NO position (claim, then close the wSOL ATA to unwrap) | B | `4WGy2ytDDk6C2MQisjVv2UeGNXXczEkSw2iuM7Nu2FKMw49WHABNpH1PihyBmMREWzkf53Xgb2UtdGxcfX1DCEdJ` | paid 0.005 SOL (its 0.002 plus the 0.003 YES side); B went from 0.008888 to 0.014990 SOL with the position rent back |
| `claim` on the losing YES position | A | `63HV4GsLhf2LSEFbxioW779u6iw5KMkWqyi6HcbaFQQwUzJnqfbTEKybn9SFQBju2oDpirrgCGN7ujhzhCfaQD1q` | payout 0, position closed, 0.0011 SOL of rent back; `paid_out` equals the pool, 0.005 SOL |
| `create_market`, deadline 7 days ahead (9 October 10:29:44 UTC) | A | `3cmoTMHExw2Bh9w5yLFNngQAvbP5X5SiAvHgWXabHiEmfphXEZjp52ux6MQioaoMn8q8EdDAnBaHZtgjZc4671vY` | market `9uhHhArjBJ5Zbxqyo2k1bs1QWRBfXxdzGcxKaz492mjq`, left open for the page and the demo |
| `stake` YES 0.004 SOL | A | `53mApDV5cx9ZyS4haQwHtp6svPQDSA9Jmdc6uPk8BtKX2SLhJs3HfK661GFhRMnP4dhu2R2WDythyVhXVDqfD3GQ` | |
| `stake` NO 0.002 SOL | B | `3ps4wZEirUTnHaj14Ye6S1nTt8uGxPDHt8G3c8VKdJTTw8y1LfbSSu4LJEJxarDm8LrWarWHSesLyhtxPdaFGSp1` | YES shows 67 percent, NO 33 percent; YES pays 1.50x, NO 3.00x |
| return 0.008 SOL to A | B | `3AUEeAA2PEeyshzeEPPWGiRFS4gHgrRwwQqC3hVeCCx3wxqqCPj3QETCitTHs3stYFaKQu89SQ7skaEoP1MWkbAo` | |

The whole run cost wallet A 0.019 SOL (0.2363 to 0.2173 SOL), most of it the two markets' rent and the two open stakes. The pool did not graduate during the test (devnet curves rarely fill), so the YES branches of `resolve` are covered by the program's LiteSVM tests rather than a live transaction; the first market resolved NO by the deadline, which is the branch a short deadline exercises.

### Checked against real transfer-hook pools

3 October 2026, read-only over the public endpoints:

- **Accounts.** A spread sample of 40 `TransferHookPool`s on each cluster (out of 2,033 on mainnet and 1,044 on devnet) decoded with `decodePool`: every one was 424 bytes, owned by the DBC program, and named a 1,128-byte `ConfigWithTransferHook` that `decodeConfig` read with a non-empty hook program. Every `sqrt_price` sat between the config's `sqrt_start_price` and `migration_sqrt_price`; every migrated pool had `finish_curve_timestamp` set and `quote_reserve` at or over its threshold; quote mints were SOL, USDC and a few devnet test mints, with sane decimals.
- **Reserve against the vault.** For four live pools (two each cluster) the decoded `quote_reserve` was a little under the quote vault's token balance, the difference being uncollected fees: for example `CoDRjxTHeLwC77RrP5Jg223UtdJqDUv2G437TESptKVi` on mainnet, 11.569203035 SOL reserve against 11.636115322 SOL in the vault.
- **Tape.** The same pools' recent transactions decoded to `EvtSwap2WithTransferHook` prints, and the newest print's `quote_reserve_amount` equalled the account's `quote_reserve` to the lamport (11,569,203,035 on that pool). The swap that filled `F5LrNe6vAGKdgLjwvwH9HaBhxVorAwHrSLfEHPx85NhG` (mainnet, USDC) carried `EvtCurveCompleteWithTransferHook`, and its reserve after matched the migrated account.
- **Pool read.** `readPool` (behind `/api/curve/pool/<address>`) served both of those pools from a cold store: `kind` `transferHook`, the trading one at 0.17 percent with a five-print tape, the other `migrated` at 100 percent. Before this change both returned 404.

The two mainnet accounts and their configs are kept as a fixture (`onchain/programs/curve_market/tests/fixtures/transfer_hook_pools.json`, hex, with the slot) that both the TypeScript tests and the program's tests decode.

## Running it

```
npm run dev                      # /curve shows "has not run yet" until a refresh
npm run agent                    # one tick: the Panta scan, then the curve refresh (needs .env.local)
npx tsx scripts/measure-curve.ts # one curve refresh with every byte counted by host
npm test                         # tests/dbc.test.ts (decoding both pool kinds, fixtures from the IDL layouts and real accounts), tests/curve.test.ts (the index) and tests/curve-market.test.ts (the market client), no network
npx tsx scripts/curve-market-devnet.ts markets   # the markets on devnet and the wallet's positions
```

To try it without the Panta scan, point `SONAR_STORE_FILE` at a scratch file and run the measure script; the dev server reading the same file then serves the index. Set `CHAIN_PROVIDER=solami` or `rpcfast` to pick the provider when both keys are present.

Files: `src/lib/dbc.ts` (decoder and math), `src/lib/dbc-idl.json`, `src/lib/curve.ts` (index, refresh, reads), `src/lib/curve-market.ts`, `src/lib/curve-market-math.ts`, `src/lib/curve-market-server.ts`, `src/app/api/curve/`, `src/app/(app)/curve/`, `src/components/CurveBits.tsx`, `src/components/CurvePoolView.tsx`, `src/components/CurveMarketPanel.tsx`, `tests/dbc.test.ts`, `tests/curve.test.ts`, `tests/curve-market.test.ts`, `scripts/measure-curve.ts`, `scripts/curve-market-devnet.ts`.
