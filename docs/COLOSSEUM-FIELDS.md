# Colosseum project fields, corrected 30 September 2026

Paste these into https://colosseum.com/arena/hackathon/project/editor?section=details (the editor silently refuses to save if any field is over its limit; every text below is within its limit). What changed: the "first African on-chain markets" and "not one on-chain market about a Nigerian event" claims are gone (competitor research showed them false), Solami and the program-log decoder are in, Vercel became Render, 14 API issues became 17, and the replay record is stated.

## Brief description (max 500)

The intelligence layer for on-chain prediction markets. Sonar scores every Panta market on Solana from its own trade tape, decoded straight from the program log, prices it against Polymarket and Kalshi, and lets users trade, claim and create markets non-custodially from one screen. A walk-forward replay over every resolved market is the public record, and a weekly Nigeria board lists questions with a rule and a named source. Open source, MIT.

(446 characters)

## Why did you decide to build this, and why now? (max 1000)

Prediction markets became infrastructure in 2026: Kalshi and Polymarket cleared $44.8B in June alone, almost all of it off-chain, US-centric and permissioned. Panta's public API is weeks old and puts the same primitive on Solana, but every integrator starts blind: no history, no analytics, no view of whether a market is cheap or rich against the world. The first integrations will define what "Panta-powered" means, and the intelligence layer is cheapest to build while the catalog is small. I already run Sonar, a live behavioural-signal engine on Kalshi and Polymarket with 672 resolved signals at a 57.7% 30-day win rate, so this is a port of a working engine, not a new hypothesis. Nigeria made it urgent: the questions Nigerians argue about every week (the CBN rate, inflation, the naira, the NGX, the Super Eagles, the petrol price) have no open market on Panta today. USDC-settled, permissionless markets with honest pricing are that product; Superteam Nigeria is the distribution.

(990 characters)

## What technologies are you using (max 500)

Panta API (14 endpoints: catalog, detail, trades, positions, primary buy quote/build/submit/verify, create quote/build/register, claim build, trade attribution), Solana (@solana/web3.js, wallet-adapter, Phantom, Solflare), Solami RPC and WebSocket (program-log stream and tape rebuilds), Next.js 14, TypeScript, Tailwind, Upstash Redis, Render, cron-job.org and GitHub Actions schedulers, Polymarket Gamma API, Kalshi API, Anthropic Claude API (market drafting), Claude Code (development)

(488 characters)

## How does your product use these chains? (max 500)

Every write is a Solana transaction the user signs. Panta builds the instructions (primary buy, claim) or a VersionedTransaction (market creation); the wallet signs; Sonar broadcasts and reports the signature to Panta. Reads combine Panta's on-chain state with the trade tape: where Panta's trades endpoint is empty, Sonar decodes prints from the program's own log and streams new ones over a logsSubscribe filter. USDC on mainnet settles all positions. Sandbox mode runs the same flows on test fixtures.

(504 characters)

## Anything else judges should know (max 500)

Zero spend: free tiers, and a sandbox switch runs the full trade, claim and create flows on Panta's test fixtures with an empty wallet, so the demo needs no funds. Live traction is read from the running store at /pitch. The record is a walk-forward replay over every resolved market (124 markets, 68 calls, 41 hits on 30 Sept), reported as-is; live settled calls are still few. 17 Panta API issues are documented in the repo. Also in the Panta API, Superteam Nigeria and Solami side tracks. MIT.

(495 characters)



# Update for the final Submit, drafted 3 October 2026

Paste these two before pressing Submit on 6 October; the other fields stay as above. Re-read the replay record on /api/agent the same day and change the numbers if they moved.

## Brief description (max 500)

The intelligence layer for on-chain prediction markets. Sonar scores every Panta market on Solana from its own trade tape, decoded from the program log, prices it against Polymarket and Kalshi, and lets users trade, claim and create markets non-custodially. Sonar Curve adds a Meteora DBC launch index and an oracle-free Anchor program for markets on whether a launch graduates. A walk-forward replay over every resolved market is the public record. Open source, MIT.

(467 characters)

## Anything else judges should know (max 500)

Zero spend: free tiers, and sandbox mode runs the full trade, claim and create flows on Panta test fixtures with an empty wallet. The record is a walk-forward replay over every resolved market (128 markets, 72 calls, 44 hits on 3 Oct), reported as-is. curve_market is on devnet with 45 tests and a threat model. 17 Panta API issues are documented. Also entered in the Panta, Superteam Nigeria, Solami, RPC Fast, Meteora, Adevar, CertiK and AkcaVPN side tracks. MIT.

(465 characters)

Technologies field: add "Anchor, LiteSVM, Meteora Dynamic Bonding Curve" if it fits under 500 (currently 488, so replace "cron-job.org and GitHub Actions schedulers" with "GitHub Actions" to make room).



# Final fields for the 6 October Submit, drafted 4 October 2026

This section replaces both sections above: paste all six, then press Submit. Every text is within its limit (the editor silently refuses to save an over-limit field). On 6 October, re-read /api/agent and update the replay numbers in the last field if they moved. Changes from the earlier drafts: Curve is in the description, chains and technologies fields; the chains field was 504 characters and is now under 500; the test count is 72 (`cargo test` on 4 Oct); "have no open market on Panta today" became "rarely have an open market on Panta" because that cannot be checked in advance.

## Brief description (max 500)

The intelligence layer for on-chain prediction markets. Sonar scores every Panta market on Solana from its own trade tape, decoded from the program log, prices it against Polymarket and Kalshi, and lets users trade, claim and create markets non-custodially. Sonar Curve adds a Meteora DBC launch index and an oracle-free Anchor program for markets on whether a launch graduates. A walk-forward replay over every resolved market is the public record. Open source, MIT.

(467 characters)

## What are you building, and who is it for? (max 1000)

Added 5 October after reading the live editor, which has this field too; the current text (972) has no Curve.

Sonar for Panta is the intelligence and execution layer for on-chain prediction markets. Panta gives any app a permissionless market-creation and trading API on Solana, but an API gives you a price and a tape, not a read. Sonar scores every Panta market from its own tape (flow, momentum, whale prints, concentration), records the price history Panta does not expose, and prices each question against Polymarket and Kalshi. From one screen users buy YES/NO non-custodially, claim winnings, and create markets from a headline with Claude drafting the rule. An agent paper-trades every call and settles against Panta's resolutions. Sonar Curve extends this to Meteora DBC launches: a decoded launch index and an oracle-free program for markets on whether a launch graduates. It is for traders who want an edge, creators who want markets that attract flow (starting with Nigerian events: CBN, inflation, naira, NGX, Super Eagles), and bots that need a signal feed.

(961 characters)

## Why did you decide to build this, and why now? (max 1000)

Prediction markets became infrastructure in 2026: Kalshi and Polymarket cleared $44.8B in June alone, almost all of it off-chain, US-centric and permissioned. Panta's public API is weeks old and puts the same primitive on Solana, but every integrator starts blind: no history, no analytics, no view of whether a market is cheap or rich against the world. The first integrations will define what "Panta-powered" means, and the intelligence layer is cheapest to build while the catalog is small. I already run Sonar, a live behavioural-signal engine on Kalshi and Polymarket with 672 resolved signals at a 57.7% 30-day win rate, so this is a port of a working engine, not a new hypothesis. Nigeria made it urgent: the questions Nigerians argue about every week (the CBN rate, inflation, the naira, the NGX, the Super Eagles, the petrol price) rarely have an open market on Panta. USDC-settled, permissionless markets with honest pricing are that product; Superteam Nigeria is the distribution.

(991 characters)

## What technologies are you using (max 500)

Panta API (14 endpoints: catalog, detail, trades, positions, primary buy quote/build/submit/verify, create quote/build/register, claim build, trade attribution), Solana (web3.js, wallet-adapter, Phantom, Solflare), Anchor, LiteSVM, Meteora Dynamic Bonding Curve, RPC Fast (RPC and WebSocket), Solami (history), Next.js 14, TypeScript, Tailwind, Upstash Redis, Render, GitHub Actions, Polymarket Gamma API, Kalshi API, Anthropic Claude API (market drafting), Claude Code (development)

(461 characters)

## How does your product use these chains? (max 500)

Every write is a Solana transaction the user signs. Panta builds the instructions (buy, claim) or a VersionedTransaction (market creation); the wallet signs, Sonar broadcasts and reports the signature. Where Panta's trades endpoint is empty, Sonar decodes prints from the program log and streams new ones over logsSubscribe. Sonar Curve decodes Meteora DBC events and pool accounts on mainnet; curve_market, an Anchor program on devnet, resolves from the pool account itself. USDC settles positions.

(499 characters)

## Anything else judges should know (max 500)

Zero spend: free tiers, and sandbox mode runs the full trade, claim and create flows on Panta test fixtures with an empty wallet. The record is a walk-forward replay over every resolved market (124 markets, 69 calls, 38 hits on 6 Oct), reported as-is. curve_market is on devnet with 72 passing tests and a threat model. 17 Panta API issues are documented. Also entered in the Panta, Superteam Nigeria, Solami, RPC Fast, Meteora, Adevar, CertiK and AkcaVPN side tracks. MIT.

(473 characters)

Note, 6 October: the Upstash store was suspended for its monthly bandwidth limit and replaced. The replay was rebuilt from chain (all 202 Panta markets found on chain, tapes through the public RPC) and now reads 124 markets, 69 calls, 38 hits (55%), down from 130/74/45 before the rebuild. The last field above carries the rebuilt numbers and is saved in the editor.
