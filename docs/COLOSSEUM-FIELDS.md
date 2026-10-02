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

