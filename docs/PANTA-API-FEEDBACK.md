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
