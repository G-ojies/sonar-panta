# Sonar for Panta: competitive landscape

_Researched 27 September 2026 for the Colosseum Crypto World's Fair (Solana track), the Superteam Nigeria track and the Panta API side track._

How to read this document: every claim carries one of three labels.

- **Checked** means we confirmed it ourselves on 27 September 2026 (GitHub API, the project's README, or an HTTP request to the live site).
- **Reported** means it comes from a named press or company source that we did not independently confirm.
- **Unverified** means we found only a weak source or none. Do not repeat these in a pitch.

## 1. Verdict

| Arena | Crowdedness | Why |
| --- | --- | --- |
| Tools built on the Panta API | **Crowded, but nobody has traction** | About 22 public repos target the side track. We checked 13 of them in detail: 6 have a live site, all were created between 19 and 27 September, and each has zero or one GitHub star. |
| Prediction-market analytics in general | **Saturated** | Kalshi and Polymarket hold about 93% of volume, both venues now ship free first-party tools, and one funded terminal has already died. |
| Prediction markets on Nigerian topics | **Moderate** | One local incumbent (Bayse) already lists naira, CBN and inflation markets. Nobody offers open creation on these topics. |

**Overall: moderate and filling up quickly.** Sonar is not alone in any single feature. It is alone in the combination, and in two things no rival has: a published walk-forward record and pricing against Polymarket and Kalshi.

**The honest one-line position:** the only Panta tool that shows its own track record, prices Panta against the deepest venues, and gives Nigerian creators ready-made market specs.

## 2. Direct competitors: other Panta API entries

These compete for the same prize with the same API. Repository facts are **Checked**. Feature descriptions are taken from each project's own README, so they are what the team claims, not what we tested.

| Project | Live site | Commits | What it claims | Where it beats Sonar | What it lacks |
| --- | --- | --- | --- | --- | --- |
| [panta-terminal](https://github.com/liji3597/panta-terminal) | [yes](https://panta-terminal.vercel.app) | 17 | "The TradingView for Panta": 113-market radar, OHLC charts from a 30-second snapshotter, WebSocket push, smart-money leaderboard with realised PnL, wallet trading, claims. Rust backend. | Finer charts (30 s against our 10 min), push updates, a wallet leaderboard. | No signal or verdict, no record, no cross-venue pricing, no market creation. |
| [panta-brief-command](https://github.com/rishu4436/panta-brief-command) | [yes](https://briefcommand.vercel.app) | 41 | AI desk: deterministic signals plus an LLM interpretation, full buy flow with attribution, claims. Has CI. | Automated tests and a CI badge. Very thorough execution flow. | No record of whether its signals were right, no cross-venue, creation explicitly out of scope. |
| [panta-signal-lens](https://github.com/farisfd90-ai/panta-signal-lens) | no | 9 | "Explainable prediction-market intelligence". | Closest to our concept in name. | No deployment, no record, small codebase. |
| [panta-signal](https://github.com/uknwplayer/panta-signal) | no | 3 | Turns market movement into explainable real-time signals. | None found. | Three commits, no deployment. |
| [pantascope](https://github.com/cjaime708/pantascope) | no | 156 | Screener, deep dive, portfolio, paper-trade lab. | Many commits. | README says the working slice is a command-line screener. It never signs or broadcasts. |
| [pantadesk](https://github.com/chi1ayomide-jpg/pantadesk) | [yes](https://pantadesk.vercel.app) | 4 | "Institutional" intelligence and execution terminal. | None found. | Four commits, very small repository. |
| [panta-copilot](https://github.com/loveoftheai/panta-copilot) | [yes](https://loveoftheai.github.io/panta-copilot/) | 35 | Natural-language copilot, market snapshots, daily brief. | Chat interface. | No trading depth, no signals with a record. |
| [sooth](https://github.com/victorhez/sooth) | [yes](https://sooth-blue.vercel.app) | 4 | "Ask the future, trade the answer": AI copilot with creation and trading. | Chat interface. | Four commits, no record. |
| [solanalens](https://github.com/sarkisk-cod/solanalens) | [yes](https://solanalens.vercel.app) | 5 | General Solana dashboard with a Panta section. | None found. | Panta is a side feature. |
| [panta-pulse](https://github.com/agenticaotearoa/panta-pulse) | no | 11 | Headline to market: drafts, validates, quotes the fee, builds the unsigned transaction. MCP server and embeddable cards. | Embeds and an MCP server, so other apps and agents can call it. Captured evidence of a live run. | No regional focus, no curated board, no signals, not deployed, last push 20 September. |
| [settlement-check](https://github.com/bisale24-ops/settlement-check) | no | 32 | Audits how each market resolves. Reports that 13 of 100 catalogued markets have no account on Solana. 77 tests. | Original research angle and strong testing. | Not a trading product. A complement more than a rival. |
| [oddsroom](https://github.com/QIU-Guanzong/oddsroom) | no | 10 | Puts a Panta forecast beside token trade flow from another data provider. | Careful about data provenance. | README says deployment and the mainnet demo are still pending. No signing flow. |
| [curveodds](https://github.com/pipapupa123/curveodds) | no | not checked | Token launchpad where each launch carries a Panta market. | Different idea entirely. | Not a competitor for the intelligence layer. |

Sonar for comparison (**Checked**): 39 commits, MIT licence, live at sonarpanta.xyz.

### Feature coverage across the Panta entries

Based on what each README mentions. A blank means the README does not mention it, which is not proof the feature is absent.

| Capability | Sonar | Rivals that mention it |
| --- | --- | --- |
| Signal with reasons | Yes | panta-brief-command, panta-signal-lens, panta-signal |
| Walk-forward replay or backtest of its own signals | Yes | None |
| Published hit rate | Yes (41 of 68 calls over 124 markets, as of 27 September) | None |
| Pricing against Polymarket and Kalshi | Yes | None |
| Tape rebuilt from the Solana program log | Yes | None for this purpose (settlement-check reads the chain to audit resolution) |
| Non-custodial trade flow | Yes | panta-terminal, panta-brief-command, pantadesk, sooth, solanalens |
| Market creation | Yes | panta-pulse, sooth, pantadesk |
| Nigerian or African content | Yes | None |
| Own price history | Yes (10 min) | panta-terminal (30 s, OHLC) |
| Push updates over WebSocket | No | panta-terminal |
| Wallet leaderboard | No | panta-terminal |
| Automated tests or CI | **No** | panta-brief-command, settlement-check, panta-pulse, pantadesk, oddsroom |
| Embeds or MCP server | No | panta-pulse |

## 3. Substitutes: analytics and signal tools on other venues

None of these cover Panta. They matter because judges know them and will ask "how is this different from X".

| Tool | Status | Venues | What it does | Traction | Publishes a signal record? |
| --- | --- | --- | --- | --- | --- |
| [Polymarket Analytics](https://polymarketanalytics.com) | Live (Reported) | Polymarket | Trader and market data, leaderboards | Unverified | No |
| [Polysights](https://polysights.xyz) | Live (Reported) | Polymarket, Kalshi | Insider finder, wallet clustering, AI summaries | $1.5M pre-seed, 24,000 users (Reported, CNBC, 24 June 2026) | No |
| Unusual Predictions (absorbed Hashdive) | Live (Reported) | Polymarket | Trader "smart score", insider flags | Unverified | No |
| [Betmoar](https://betmoar.fun) | Live (Reported) | Polymarket | Terminal and Discord bot, money-flow view | About $101M in 30-day volume routed (Reported, one X post) | No |
| [Oddpool](https://oddpool.com) | Live (Reported) | Kalshi, Polymarket | Cross-venue odds and arbitrage data API | Unverified | No |
| [Stand](https://stand.trade) | Live (Reported) | Polymarket | Terminal, whale alerts, copy trading | About $9.6M in 30-day volume (Reported) | No |
| [Matchr](https://matchr.xyz) | Live (Reported) | Five venues | Matches the same event across venues | Unverified | No |
| Kalshi Pro | Live, free beta since 13 July 2026 (Reported) | Kalshi | First-party desktop terminal and live tape | Venue leader | No |
| Olas Polystrat | Live (Reported) | Polymarket | Autonomous trading agents | About 37% of agents profitable (Reported, CoinDesk, 15 March 2026) | Partly: trades are on chain, no walk-forward record |
| BillyBets | Beta (Reported) | Polymarket and others, on Base | AI sports picks posted on chain | $1M pre-seed (Reported) | Partly: no independently verified record |
| Predly | Beta (Reported) | Polymarket, Kalshi | AI probability against market price | Unverified | None found |

**What they leave unresolved.** They describe what happened (who bought, which wallet is smart) and stop short of a verdict that is later scored. None publishes a walk-forward record of its own calls. None covers a Solana-native venue.

### Dead and absorbed projects

| Project | What happened | Lesson for Sonar |
| --- | --- | --- |
| Fireplace | Terminal for Polymarket and Kalshi. Raised $1.5M in February 2026, halted trading on 15 August 2026 after about 195 days (Reported). Press links the closure to Kalshi launching a free terminal a month earlier. The company gave no reason. | A terminal on someone else's venue is squeezed the day the venue ships its own. Panta has its own app. Sonar must be more than a view. |
| Trepa | **Unverified, sources conflict.** One source says this Solana prediction app (a past Colosseum winner) closed in August 2026, another lists it as live. Do not cite either way. | None until confirmed. |
| Aver | Solana betting exchange. Raised $7.5M, now discontinued, team moved to a casino product (Reported). | Order-book venues on Solana have died from low volume. |
| Drift BET | Solana prediction markets, halted when the parent protocol lost about $285M in an exploit on 1 April 2026 (Reported, Chainalysis). | Venue risk is real. A signal engine should be able to point at another venue. |
| Hashdive | Absorbed into Unusual Whales in January 2026 (Reported). | Trader scoring is a feature, not a company. |
| Dome | Data API bought by Polymarket, shut down 28 April 2026 (Reported). | Data layers get acquired or replaced by the venue. |
| Polycule | Telegram copy-trading bot, hacked for about $230,000 on 13 January 2026 (Reported). | Custody of user keys is the risk. Non-custodial is a selling point worth stating. |
| Probo (India) | Opinion-trading leader, ended real-money play in August 2025 after a national online gaming law (Reported). | An emerging-market leader was removed by a gambling classification. See the Nigeria section. |

## 4. Nigeria: incumbents and substitutes

**This section corrects our own earlier claim.** The business plan said "there is not one on-chain market about a Nigerian event today". That is wrong and must not be repeated:

- Polymarket lists Nigerian 2027 election markets, settled on chain. The presidential market shows about $128,000 in volume (Reported).
- Bayse Markets lists naira-funded markets on USD/NGN, CBN rate decisions and inflation prints (Reported, Nairametrics, 8 April 2026). These overlap with four of our six board topics.

| Player | What it offers | Overlap with our Nigeria board | What it lacks |
| --- | --- | --- | --- |
| [Bayse Markets](https://bayse.markets) (formerly Gowagr) | Naira-funded yes/no markets: sports, politics, FX, CBN, inflation. Has a Superteam Nigeria partnership for stablecoin deposits. | Naira, CBN, inflation, probably Super Eagles | Markets appear to be written in-house, no open creation. Publishes no user or volume numbers. Petrol and NGX markets not found. Listed as unlicensed by the Lagos regulator (Reported, TechCabal). |
| Luno with Limitless | Crypto price up/down markets in Nigeria and South Africa since 19 March 2026 | None | Crypto prices only. |
| OpinionMarket | Naira markets on the World Cup and the 2027 election, announced 6 June 2026 | Football, politics | Licence claim unverified, no macro markets seen. |
| Busha Signal | Sports prediction markets, launched August 2026, licensed in Lagos (Reported, ThisDay) | Football | Sports only. |
| Polymarket | Open to Nigerian users who fund with crypto | Elections only | No naira, inflation, CBN, NGX, petrol or Super Eagles markets. |
| SportyBet, Bet9ja | Fixed-odds betting. SportyBet had about 49M monthly visits in Nigeria in August 2026, Bet9ja about 15M (Reported, Semrush) | Football | Bookmaker margin, no macro or news markets, no way to create a market. |
| Tipster and forex signal groups on Telegram | Free picks and copy-paste trades | Signals | No audited record, documented scams. |
| AbokiFX | The reference for the parallel naira rate | Naira | Information only, no way to take a position. |

**Regulation (Reported).** A Supreme Court ruling on 22 November 2024 made gaming a matter for states rather than the federal lottery regulator. No Nigerian regulator has made a specific statement on prediction markets that we could find. State regulators are treating them as gaming. This is a real risk for any real-money product and should be named in the pitch rather than avoided.

**What nobody offers.** Open creation on Nigerian topics with a proper resolution rule: which data release settles the market, which exchange rate counts, and when it closes. Our board does exactly this. Petrol and NGX specs appear to be unique to us.

## 5. Solana prediction-market venues

Panta is one of many Solana venues. Figures here are **Reported** unless marked, and several come from aggregator pages, so quote them with care.

| Venue | Status | Traction | Does any third-party signal tool cover it? |
| --- | --- | --- | --- |
| Panta | Live. Permissionless creation through the API, creation fee observed at 50 USDC. | No public volume or funding figure found. A content bounty drew 410 submissions. | Only the hackathon entries in section 2. |
| Jupiter Predict and Forecast | Live. Kalshi-powered since October 2025, Polymarket added February 2026. | $5.3M volume in April 2026, about $17M cumulative | Only tools for the underlying Kalshi and Polymarket markets. |
| DFlow (tokenised Kalshi contracts) | Live since December 2025. Lost Phantom as its main distribution partner in June 2026. | $22.4M in its first weeks, current volume unverified | Generic Kalshi tools. |
| World Prediction Markets | Live inside Phantom since 1 July 2026. | No volume found | None found. |
| PNP Exchange | Live. Permissionless bonding-curve markets with an SDK. | No volume found | None found. |
| Melee | Beta. $3.5M raised (CoinDesk, 24 September 2025). | Unverified | None found. |
| Worm.wtf | Live since October 2025. $4.5M pre-seed. | No volume found | None found. |
| MetaDAO | Live. Decision markets rather than event markets. | Unverified | Tracked by data sites only. |
| Hedgehog, Monaco, BetDEX, Triad | Status unverified, sources conflict. | Unverified | None found. |

**Pattern across the small venues:** none has an independent signal or analytics layer. Every tool in the wider ecosystem targets Polymarket or Kalshi. That supports the case for Sonar and also shows a way to reduce dependence on Panta: the same engine could later read PNP or DFlow.

### Past Colosseum winners in this category

| Project | Hackathon | Result | What it was |
| --- | --- | --- | --- |
| Triad | Renaissance, 2024 | Honourable mention | Prediction markets |
| Pregame | Radar, 2024 | 1st, Consumer | Peer-to-peer sports betting |
| Trepa | Breakout, 2025 | 1st, Consumer | Numeric prediction app |
| Melee | Breakout, 2025 | 2nd, Consumer | Viral permissionless markets |
| Capitola | Cypherpunk, 2025 | 1st, Consumer | Aggregator across prediction venues |
| Senthos | Frontier, 2026 | Top 25, accelerator | Structured products over prediction-market flow |
| Bench | Frontier, 2026 | Top 25 | Markets that reward private signals |

Source: Colosseum's winner announcements for each hackathon.

**What this tells us.** Every prediction-market winner so far has been a venue, an aggregator or a structured product. No analytics or signal layer over a small Solana venue has won. That can be read two ways: the space is open, or judges have preferred products that hold volume. The pitch should therefore stress what Sonar does with money (routed trades, created markets, creator fees), not only what it shows.

## 6. Defensibility

| Moat type | Rating for Sonar | Reason |
| --- | --- | --- |
| Data advantage | **Most realistic** | The record, the stored price history and the chain-rebuilt tapes grow every day and cannot be backdated by a rival who starts later. |
| Brand and trust | Possible | A public, scored record is the opposite of a tipster channel. It takes months to build. |
| Technical complexity | Weak | The repo is open source. A good team could copy the tape decoder in days. |
| Distribution | Weak today | No users yet. Superteam Nigeria is the only channel. |
| Network effects, switching costs | None | |

**Biggest threat:** Panta ships its own analytics, or changes the API, and the layer on top loses its reason to exist. The Fireplace closure is the precedent. The defence is to own things Panta will not build: the cross-venue comparison, the scored record, and the Nigerian market specs.

## 7. What to change because of this research

Ordered by how much each one matters before judging.

1. **Correct the Nigeria claim** in the business plan, deck and submission text. Replace "not one on-chain market about a Nigerian event" with a claim that survives a search: "no venue lets anyone create a properly specified market on Nigerian data releases".
2. **Narrow the "only one" claim.** Say "the only Panta entry that prices against Polymarket and Kalshi", which the README comparison supports, rather than "the only one" in general.
3. **Name Bayse before a judge does.** Use it as proof that Nigerians want these markets, then state the difference: open creation, USDC settlement, non-custodial, and topics Bayse does not list.
4. **Add automated tests and CI** for the signal engine and the replay. Five rivals have them and we have none. For a product whose whole pitch is a trustworthy record, this is the weakest point in the repository.
5. **Lead every pitch with the record.** It is the one thing no rival in any table above has.
6. **Filter markets with no on-chain account.** settlement-check reports 13 of 100 catalogued markets cannot be traded. Confirm the Radar hides them.
7. **Set the repository's website field** to sonarpanta.xyz. Six rivals show a live link on their GitHub page and ours is blank.
8. **Show the creator what a market is worth.** A creator pays about 50 USDC with no data on which questions attract trades. Sonar already has the replay data to answer this, and no rival does.
9. **Get real users.** No entry in the Panta field shows any usage. Five to ten named testers with quotes would put Sonar ahead on the "traction" criterion.

## Sources

Direct competitors: GitHub API and project READMEs, read 27 September 2026.

Analytics tools and closures:
- https://defiprime.com/definitive-guide-to-the-polymarket-ecosystem
- https://www.cnbc.com/2026/06/24/polymarket-backed-platform-boosts-funding-to-root-out-insider-trading-on-prediction-markets.html
- https://news.kalshi.com/p/kalshi-pro-trading-terminal
- https://cryptobriefing.com/fireplace-shuts-down-september-30-withdrawal-deadline/
- https://cryptopotato.com/195-days-and-done-why-this-crypto-prediction-platform-just-shut-down/
- https://www.coindesk.com/tech/2026/03/15/ai-agents-are-quietly-rewriting-prediction-market-trading
- https://github.com/aarora4/Awesome-Prediction-Market-Tools

Solana venues and past winners:
- https://docs.panta.market
- https://www.cryptotimes.io/2026/06/05/jupiter-unveils-forecast-to-power-solana-prediction-markets/
- https://solanafloor.com/news/prediction-markets-on-solana-28-6-m-in-early-onchain-volume-across-jupiter-and-d-flow
- https://www.chainalysis.com/blog/lessons-from-the-drift-hack/
- https://www.coindesk.com/business/2025/09/24/melee-raises-usd3-5m-to-launch-viral-prediction-markets-without-gatekeepers
- https://blog.colosseum.com/announcing-the-winners-of-the-solana-cypherpunk-hackathon/
- https://blog.colosseum.com/announcing-the-winners-of-the-solana-frontier-hackathon/

Nigeria:
- https://nairametrics.com/2026/04/08/africas-largest-prediction-market-bayse-launches-financial-markets/
- https://techcabal.com/2026/03/19/luno-launches-prediction-markets/
- https://www.thisdaylive.com/2026/08/04/busha-launches-signal-bringing-prediction-markets-to-nigerian-sports-fans/
- https://igamingbusiness.com/legal-compliance/nigeria-lottery-supreme-court/
- https://polymarket.com/predictions/nigeria
