# Sonar Curve: the Meteora DBC data path

Sonar Curve follows token launches on Meteora's Dynamic Bonding Curve (DBC): the price along each curve, the quote it has raised, how far it is from graduation, and the prints behind that, decoded from the program's own events and accounts. It is served on `/curve` and as JSON for terminals. The on-chain graduation markets (a parimutuel YES/NO on whether a curve graduates before a date, resolved from the pool account itself) are the `curve_market` program on the `curve-program` branch; the pool page keeps a panel for them. The plan is in [CURVE-PLAN.md](CURVE-PLAN.md).

Nothing here needs an SDK or an indexer. The program's IDL (`src/lib/dbc-idl.json`, program version 0.2.1) is the only source of truth for discriminators and layouts, and the chain is the only source of data, read through the same RPC path as the Panta tape (Solami or RPC Fast when a key is set, the public endpoint otherwise; see [SOLAMI.md](SOLAMI.md)).

## The program

`dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN`, the same id on mainnet and devnet. A launch is a `VirtualPool` account holding a base token and a quote token (SOL or USDC in practice) with a constant-product curve in `sqrt_price` space. Traders buy and sell along it; when the quote the pool holds reaches the config's `migration_quote_threshold`, the curve is complete and the liquidity migrates to a Meteora DAMM v2 pool. That is graduation.

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

### Events used

| Event | What Sonar takes from it |
| --- | --- |
| `EvtInitializePool` | pool, config, creator, base mint, activation point: a launch enters the index with its creation time |
| `EvtSwap2` | pool, trade direction, amounts in and out, `next_sqrt_price`, `quote_reserve_amount`, `migration_threshold`: one print, with price and progress after it |
| `EvtSwap` | the legacy swap, turned into a print only when no `EvtSwap2` came with it (no reserve figures then) |
| `EvtCurveComplete` | decoded and available; the account's `finish_curve_timestamp` says the same thing and is what the status reads |

`trade_direction` 1 is quote to base, a buy; 0 is base to quote, a sell. On a buy the quote that moved is `included_fee_input_amount` (what the trader paid, fee included) and the base is `output_amount`; on a sell the other way round.

### Accounts

`VirtualPool` (discriminator `[213,224,5,209,98,69,119,92]`) and `PoolConfig` (`[26,108,14,123,116,230,129,43]`) are bytemuck accounts. Their Rust layouts carry explicit padding so no implicit alignment padding exists, which is what lets the same sequential reader decode them; the sizes the IDL implies, 424 and 1,048 bytes with the discriminator, match the live accounts exactly. Offsets after the discriminator that a program reading the pool needs (`offsetOf` in `dbc.ts` computes them from the IDL):

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
    "address": "BSTNBGAymY8PfNCMUTnr9y6tdCPZpRnELeN7zxaYUgUa",
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

Rows come trading pools nearest graduation first, then complete, then migrated. `prints` counts what Sonar has decoded for the pool, bounded, not the pool's lifetime count. Before the first refresh the body is `{ "pools": [], "note": "the curve index has not run yet" }`.

### `GET /api/curve/pool/<address>`

Never cached. 400 for a string that is not a public key, 404 for an account that is not a `VirtualPool`.

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
  "market": null
}
```

`tape` is newest first, up to 200 prints. Price after a print is `(sqrtPriceAfter / 2^64)^2 * 10^(baseDecimals - quote.decimals)`; progress after it is `quoteReserveAfter / migrationThreshold`. `tapeComplete` is true when the pool's whole history fit the bounds. `market` is reserved for the graduation market once the program is wired.

## Pages

- `/curve`: the index as a list, with a status filter, a progress bar per pool, quote raised against the threshold, price, prints seen, the largest print and age. A table on wide screens, cards on phones. A lookup box opens any pool address.
- `/curve/<address>`: price, the graduation progress with what is left to raise, the price path drawn from the tape, the account fields behind graduation, the tape, the largest prints, and the reserved graduation market panel. Polls its API every 30 seconds.

## Running it

```
npm run dev                      # /curve shows "has not run yet" until a refresh
npm run agent                    # one tick: the Panta scan, then the curve refresh (needs .env.local)
npx tsx scripts/measure-curve.ts # one curve refresh with every byte counted by host
npm test                         # tests/dbc.test.ts (decoding, fixtures from the IDL layouts) and tests/curve.test.ts (the index), no network
```

To try it without the Panta scan, point `SONAR_STORE_FILE` at a scratch file and run the measure script; the dev server reading the same file then serves the index. Set `CHAIN_PROVIDER=solami` or `rpcfast` to pick the provider when both keys are present.

Files: `src/lib/dbc.ts` (decoder and math), `src/lib/dbc-idl.json`, `src/lib/curve.ts` (index, refresh, reads), `src/app/api/curve/`, `src/app/(app)/curve/`, `src/components/CurveBits.tsx`, `src/components/CurvePoolView.tsx`, `tests/dbc.test.ts`, `tests/curve.test.ts`, `scripts/measure-curve.ts`.
