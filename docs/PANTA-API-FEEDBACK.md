# Panta API — integration notes and feedback

Collected while building Sonar (September 2026) against `https://live-api.panta.market/api/v1`.
Everything below was reproduced with a `pk_live_` key unless stated.

## What worked well
- The quote → build → sign → submit/register session model is clean and genuinely non-custodial. Instruction lists (primary buy, claims) compile straight into a v0 transaction; create returns a ready `VersionedTransaction`.
- Error envelopes with stable `code`s made the client trivial to harden (`QUOTE_STALE`, `MARKET_NOT_IN_PRIMARY`, `TX_MISMATCH` map to clear UI copy).
- Rate-limit headers are present on every authenticated response and match the documented families.
- `GET /markets/{id}/` is rich: the full on-chain state (`onChain.*`), resolution rule, sources, oracle, and both price scales.
- `pk_test_` sandbox keys let a CI pipeline exercise every flow without touching mainnet.

## Bugs / gaps found (ordered by impact)
1. **List rows have empty `title` / `description`** — every row from `GET /markets/` had `title: ""`, while `GET /markets/{id}/` returns the question. A catalog consumer must hydrate every row (1 extra call per market) just to show a name. Suggest populating `title` on list rows.
2. **Cursor pagination loops** — `nextCursor` is returned, but passing it back yields the same page (also with `offset`/`page`). Unfiltered lists therefore cap at 50 rows; we widened coverage by fanning out over `status` × `category` and de-duplicating.
3. **`status=resolved` returns zero rows**, although resolved markets appear in the unfiltered list. Backtesting had to discover resolved markets via the unfiltered/category lists.
4. **Stale `phase` on list rows** — dozens of rows tagged `primary` return `MARKET_NOT_IN_PRIMARY` on quote, and `onChain.isActive` on detail is `false`. A `tradable` boolean on list rows (or refreshing `phase` from chain on read) would save a round-trip per market.
5. **Two programs in one catalog** — 14 rows belong to program `4CQ4…` (devnet) and are not found by the mainnet write path (`MARKET_NOT_FOUND`). Filtering by `programId` on the server, or exposing a `cluster` field, would avoid confusion.
6. **Price scale inconsistency** — `yesPrice` is a decimal (`"0.43"`) while `secondaryYesPrice` / `lastYesPrice` on the same detail row are 1e9-scaled integers (`"431388429"`). Documenting the scale or normalising would prevent silent 1e9× bugs.
7. **`GET /positions/` 504s for busy wallets** (e.g. `Gjafbm…`) while small wallets return instantly. Pagination or a lighter default would help.
8. **`POST /markets/create/build/` fails with a generic `INVALID_MARKET_PARAMS: unexpected create build failure`** when the creator wallet has no USDC token account. The same request succeeds for a funded wallet. A specific code (`NO_USDC_ACCOUNT`) would be much friendlier.
9. **Trade rows carry `amountUsdc: null`** for older prints; only share counts are present, so USDC flow has to be inferred.
10. **No secondary-market trading endpoints** — graduated markets can be read but not traded through the API. A `secondaryorderquote/build` pair would let integrations cover the full lifecycle.
11. `startTime`/`endTime` are ISO strings on the sandbox fixture but unix integers on live rows.
12. Non-browser user agents (`python-urllib`) get a Cloudflare 403; `curl`/Node are fine. Worth documenting.

## Requests
- Titles + `tradable` flag on list rows; working cursor; `status=resolved` filter.
- A websocket or `since=` parameter on `/markets/{id}/trades/` for tape streaming.
- A public "markets opened in the last N hours" feed so bots can catch primary windows, which are short for breaking markets.

## Added 23 September 2026
13. **`category` is `sports` on most non-sport markets** — of 113 detail rows scanned, 74 carry `category: "sports"`, including "Will Bitcoin hit $65,000 in the next 10 minutes?", "Will it rain anywhere in London in the next 30 minutes?" and "Base Blockchain to announce airdrop rewards". It looks like breaking markets default to `sports` at creation. Category filters on `GET /markets/` are therefore unreliable for discovery.
14. **Listing pages rotate between scans** — two `GET /markets/?status=secondary` scans four minutes apart returned different 50-row sets, and live markets ("Will GTA 6 release on November 19th, 2026?") disappeared from the listing while still `isActive` on chain. Integrators must keep their own registry of ids; a stable sort (`createdAt desc`) plus a working cursor would fix both this and item 2.
15. **`GET /markets/{id}/` intermittently returns a stripped row** — for a resolved market the same call returns, at different moments, either the full row (`title`, `resolutionRule`, `onChain.*`, `phase: "resolved"`) or a skeleton with `title: ""`, `onChain: null` and `phase: "secondary"`, with HTTP 200 both times. In one scan 33 of 113 markets came back stripped. It looks like a cache miss path that returns the catalog row without the chain lookup. A 5xx, or a `partial: true` flag, would let clients retry instead of trusting the skeleton.

## Added 26 September 2026
16. **P2P and region-tagged markets are not reachable through the partner API.** panta.market/dashboard shows "Will Dangote Refinery be valued at over $60 billion before March 31, 2027?" (FINANCE, P2P) as the featured market, but no combination of `GET /markets/` parameters returns it: `status=primary|secondary` with every category, `marketType=p2p`, `type=p2p`, `search=`, `q=`, `featured=true`, `region=Nigeria|Africa|NG` all return the same Global slices (the region filter is ignored: every row still says `region: "Global"`). Statuses other than `primary`/`secondary` return empty, as do categories outside the nine the docs name (`weather`, `gaming`, `stocks`, `commodities`, `business`, `pop-culture`, `macroeconomics` all return 0 even though detail rows carry those categories). An integrator building a country desk cannot find the country's markets. Suggest: expose P2P markets in the listing (or a `type=p2p` filter), honour `region=`, and accept every category the detail rows use.
17. **`GET /markets/{id}/trades/` is empty or truncated for most markets.** Of 85 resolved markets on our radar, 63 return `items: []` although `onChain.totalTrades` on the same detail row is 1 to 38, and the rest return a fraction of the prints (Tesla $330: 4 of 30; Verstappen Dutch GP: 5 of 20; Solana $81.50: 5 of 14). Every graduated (secondary-phase) market returns nothing at all, so a market like "Will Bitcoin drop below 58k in 2026?" shows 18 trades on chain and an empty tape through the API. The program itself logs each primary order (`Primary Order (USDC): side=No, amount=…, yes_price=…, no_price=…, minted=…`, and an older `lamports=` form for SOL-quoted markets), so we rebuilt the tapes from `getSignaturesForAddress` + `getTransaction` on a public RPC; an indexer that reads the same log would let the endpoint return the full tape, ideally with the `yes_price` after each print, which is the one number a signal engine most wants and the API does not send.
