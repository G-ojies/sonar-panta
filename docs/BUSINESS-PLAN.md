# Sonar for Panta — business plan

_Prepared for Colosseum's Crypto World's Fair (Solana track), the Superteam Nigeria track and the Panta API side track. September 2026._

## 1. One line

Sonar is the intelligence and execution layer for on-chain prediction markets: it tells traders, creators and bots which Panta markets are mispriced, why, and lets them act on it from their own wallet.

## 2. The problem

Prediction markets stopped being a curiosity in 2026. Kalshi and Polymarket cleared about $24B in April and $44.8B in June (World Cup), up from under $5B a month in September 2025. Almost all of that volume is off-chain, US-centric and permissioned.

Panta brings permissionless market creation and parimutuel trading to Solana behind a clean, non-custodial API. That solves distribution: any app can embed a market. It does not solve *intelligence*. An integrator gets a price and a trade tape. It does not get:

- price history (Panta has no history endpoint);
- tape analytics (who is buying, how concentrated, how fast);
- a view of whether a Panta market is cheap or rich against the deepest venues in the world;
- a way to know which markets are worth creating.

Result: thin markets stay thin. The catalog we scanned had 113 markets, a handful open at any moment, and untraded markets sitting 37 points away from Polymarket on the same question.

In Nigeria the gap is sharper. About 60 million Nigerians bet, the market is worth roughly $3.6B a year, football-first and 83% mobile. Every week Nigerians already argue over the CBN rate decision, the NBS inflation print, the naira, NGX and the Super Eagles. They do it on bookmakers with a 10–20% overround, in naira that loses value while the ticket is open. Local venues such as Bayse now list naira-funded markets on the exchange rate, CBN decisions and inflation, which proves the demand. But those markets are written in-house, and Polymarket's Nigerian coverage stops at the 2027 elections. No venue lets anyone create a properly specified market on a Nigerian data release.

## 3. The product

Sonar for Panta is a Next.js app plus a scheduled engine, all open source (MIT):

| Surface | What it does |
| --- | --- |
| Radar | Every market the Panta API exposes, scored from its own tape (flow imbalance, momentum, whale prints, wallet concentration, velocity, staleness) and priced against Polymarket and Kalshi. |
| Market | The read with reasons, our own 10-minute price history, cross-venue gap, resolution rule, full tape with Solscan links. |
| Trade | Quote → build → sign in wallet → broadcast → submit → report. Non-custodial, attributed to Sonar on Panta. |
| Portfolio | Positions marked to live prices, one-click claims. |
| Create | Headline or URL → resolvable YES/NO market drafted by Claude → quote → sign → registered. Nigeria starter boards. |
| Agent | Unattended paper (or live) trading on every call, settled against Panta resolutions, plus a backtest over resolved markets. |

Fourteen Panta endpoints are integrated. Twelve API issues (now fourteen) were found and documented for the Panta team during the build.

## 4. Why now, why us

- **Timing.** Panta's public API is weeks old; the first integrations define what "Panta-powered" means. Being the reference intelligence layer while the catalog is small is cheap; doing it after it is large is not.
- **Track record.** Sonar already runs live on Kalshi and Polymarket (sonar.nodalytics.xyz): 672 resolved signals, 57.7% 30-day win rate. This is a port of a working engine, not a new hypothesis.
- **Venue-neutral by construction.** The same engine sees the off-chain tape, so Sonar is also the bridge that shows off-chain traders where Solana is mispriced. That is the flow Panta needs most.
- **Team.** Solo founder-engineer in Benin City with shipped Solana work (onchain-rbac, smart-tx-stack, worldcup-match-vault).

## 5. Business model

Three revenue lines share one engine and one cost base.

1. **Creator fees (live today).** Panta pays creators a share of the activity their markets attract. Sonar creates and seeds the markets its signals say the world is missing, starting with a weekly Nigeria board (CBN, NBS, naira, NGX, Super Eagles, fuel). Each board is a portfolio of fee-earning markets.
2. **Attribution and order flow.** Every trade routed through Sonar is reported to Panta with attribution. Sonar is built to be the integration that brings volume, and to be paid for it under Panta's partner terms as those formalise.
3. **Sonar Pro (Q1 2027).** The signal and cross-venue feed as a paid API and an embeddable Radar widget for bots, communities and other Panta integrations. Later, a managed agent vault where users delegate USDC to the live agent.

Cost base: one Vercel deployment, one Redis, one scheduled job. Under $50 a month at current scale. The signal engine is deterministic; Claude is used only for drafting.

## 6. Go-to-market

**Phase 1 (October): Nigeria, from the community outward.**
- Superteam Nigeria's builder and trader network as the first user base; weekly Nigeria board announced on X and Telegram.
- University communities where the founder studies and teaches (Benin City), mobile-first.
- Public agent track record as the marketing asset: every call is logged and settled in the open.

**Phase 2 (November): creators and bots.**
- Radar widget for creators to embed alongside their markets.
- Telegram alerts on new calls and primary windows.
- Sonar Pro pilot with two or three Panta integrations.

**Phase 3 (December onward): capital.**
- Live agent capital on primary windows once the paper record is long enough.
- Colosseum accelerator or Solana Foundation milestone grant to fund a second engineer.

## 7. Market size

- Prediction markets: $44.8B monthly volume in June 2026 across the two largest venues; Solana's share is negligible today, which is the opportunity.
- Nigeria betting: ~$3.6B a year, ~60M bettors, online segment growing over 16% a year.
- Even 0.1% of Nigerian betting stake routed into USDC-settled on-chain markets is $3.6M a year of volume, and Sonar earns on creation, attribution and Pro subscriptions on top of it.

## 8. Competition

| | What they do | How Sonar differs |
| --- | --- | --- |
| Panta's own app | Trade and create markets | Sonar adds the intelligence Panta does not expose, and sends the flow back to Panta with attribution. Complement, not competitor. |
| Other Panta side-track entries (about 22 public repos; panta-terminal and panta-brief-command are the strongest) | Terminals, charts, AI briefs, signals, headline-to-market tools | Some have finer charts or push updates. None scores its own signals, publishes a hit rate, prices against Polymarket and Kalshi, or carries Nigerian content. |
| Polymarket / Kalshi analytics tools (Polysights, Betmoar, Stand, Kalshi Pro) | Wallet tracking, terminals and data for the two largest venues | None covers Panta or any small Solana venue, and none publishes a walk-forward record of its own calls. |
| Bayse and other Nigerian prediction venues | Naira-funded markets on FX, CBN, inflation and sports, written in-house | Sonar offers open creation with a full resolution rule, USDC settlement, non-custodial trading, and topics they do not list (petrol, NGX). |
| Nigerian bookmakers | Fixed-odds, naira, 10–20% overround | Parimutuel, USDC-settled, permissionless, with transparent pricing. |

Full research with sources: [COMPETITIVE-LANDSCAPE.md](COMPETITIVE-LANDSCAPE.md).

**Platform risk.** Fireplace, a funded terminal built on Polymarket and Kalshi, closed in August 2026 a month after Kalshi shipped a free terminal. Sonar's answer is to own what Panta will not build: the cross-venue comparison, the scored public record and the Nigerian market specs. The engine is venue-neutral and can read another Solana venue if needed.

## 9. Traction to date

- Sonar off-chain: 672 resolved signals, 57.7% 30-day win rate.
- On Panta: 64 markets tracked, backtest over resolved Panta markets with a small sample reported as-is, autonomous agent running since 19 September with every call logged.
- 14 API issues documented and shared with Panta.
- Built during the hackathon window; live deployment and public repo.

## 10. Risks

- **Catalog depth.** Panta has few open markets at any moment. Mitigation: Sonar creates markets (Nigeria board) and the radar keeps a persistent registry so live markets are never lost.
- **Secondary trading.** The API does not expose secondary-market trading yet. Mitigation: primary windows first; secondary support the week Panta ships it.
- **Regulation in Nigeria.** Prediction markets sit near betting law, and since the Supreme Court ruling of November 2024 gaming is regulated by the states, which are treating prediction venues as gaming. Mitigation: USDC-settled, non-custodial, information-first product; no house, no odds, no custody.
- **Solo team.** Mitigation: deterministic engine, small surface area, funding path to a second engineer.

## 11. The ask

- Colosseum: accelerator consideration and the Solana track prize to fund the first hire.
- Superteam Nigeria: pitch-review slots, distribution to the Nigerian trader community, and a demo-day slot.
- Panta: partner status, secondary endpoints, and a channel for the API feedback.

## Sources

- TRM Labs, "How Prediction Markets Scaled to USD 21B in Monthly Volume in 2026"; CoinLaw prediction-market statistics (June 2026 combined volume); Bitcoin.com News, April 2026 volume.
- GeoPoll, "Betting in Africa 2026"; News Agency of Nigeria and BusinessDay, Nigeria betting market 2026.
- Panta API observations: docs/PANTA-API-FEEDBACK.md in this repository.
