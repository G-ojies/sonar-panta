# Submission answers

Deadlines: Colosseum 12 October 2026 · Superteam Nigeria track and Panta side track 13 October 2026 06:59 UTC. Winners for both Earn tracks announced by 27 October 2026.

Status 27 September 2026: deployed at https://sonarpanta.xyz; videos recorded; Colosseum project complete (final Submit button opens 6 October 04:00 PDT); both Earn forms are OPEN now (Submit Now on both listings) and can be edited until the deadline. Remaining: submit both Earn forms, press Submit on Colosseum on 6 October, attend two more Superteam NG pitch reviews and demo day.

## Colosseum — Crypto World's Fair (Solana ecosystem track, country: Nigeria)

- **Project name:** Sonar for Panta
- **One-liner:** The intelligence layer for on-chain prediction markets: behavioural signals, cross-venue pricing and one-click non-custodial trading for Panta markets on Solana.
- **Description:** Sonar for Panta scans every market the Panta API exposes, scores each one from its own trade tape (flow imbalance, 24h momentum, whale prints, wallet concentration, velocity), records the price history Panta doesn't expose, and prices every question against Polymarket and Kalshi to surface mispricings. From the same screen users buy YES/NO non-custodially through Panta's quote → build → sign → submit flow, claim winnings, and create new markets from a headline with Claude drafting the resolution rule, starting with Nigeria boards (CBN, NBS inflation, naira, NGX, Super Eagles). An autonomous agent paper-trades every call and settles against Panta's resolutions, publishing a live track record alongside a walk-forward replay over resolved Panta markets, with the tapes Panta's API does not return decoded from the program log on chain. Fourteen Panta endpoints are integrated; seventeen API issues were found and documented for the Panta team. Built by the team behind Sonar (sonar.nodalytics.xyz), a live signal engine on Kalshi/Polymarket with 672 resolved signals at a 57.7% 30-day win rate.
- **Repository:** https://github.com/G-ojies/sonar-panta (MIT)
- **Live app:** https://sonarpanta.xyz · pitch deck at https://sonarpanta.xyz/pitch
- **Presentation video (≤ 3 min):** https://www.loom.com/share/64fdea3e83e147ee865af08b016792fa
- **Technical demo (≤ 3 min):** https://youtu.be/F6bmSKXT0fg
- **Team:** Great Ojietohamen (solo), Benin City, Nigeria. Solana: onchain-rbac, smart-tx-stack, worldcup-match-vault (trustless TxLINE settlement CPI), GroupStage.
- **Pre-existing code / provenance:** Signal design carried over from the author's off-chain Sonar (closed source). Every line in this repository was written during the hackathon window against the Panta API. No prior funding for either.
- **Go-to-market:** Nigeria first via Superteam Nigeria's community and university networks, weekly Nigeria market boards, public agent track record; then creators and bots via an embeddable Radar widget and Sonar Pro API. Full plan in docs/BUSINESS-PLAN.md.
- **Tracks:** Solana ecosystem track; Panta API side track; Superteam Nigeria side track.

## Superteam Earn — Colosseum Crypto World's Fair | Superteam Nigeria Track

- **Project Name:** Sonar for Panta
- **Project Description:** (same text as the Colosseum description above, then:) Value to the Solana ecosystem: it turns Panta's raw API into a place traders can find an edge, brings off-chain prediction-market flow onto Solana by pricing Panta against Polymarket and Kalshi, and brings open creation of Nigerian-topic markets to Solana through the Create flow. Judging criteria mapping: working product live on mainnet (functionality); first intelligence layer over Panta and first Nigerian on-chain markets (novelty, impact); terminal-grade UX with plain-language error handling and non-custodial flows (UX); MIT licensed with a public repo (open source); business plan in docs/BUSINESS-PLAN.md (business plan).
- **Project Github Link:** https://github.com/G-ojies/sonar-panta
- **Project Website:** https://sonarpanta.xyz
- **Project X Link:** https://x.com/Great_ojies/status/2103387182601994515
- **Link to your pitch deck or Loom/video presentation:** https://www.loom.com/share/64fdea3e83e147ee865af08b016792fa (deck: https://sonarpanta.xyz/pitch)
- **Did you submit this project to the official Frontier Hackathon on Colosseum? (Yes/No):** Yes (Crypto World's Fair, Solana track, country: Nigeria)
- **Link to Colosseum project:** https://colosseum.com/arena/projects/sonar-for-panta
- **Link to your project's Colosseum profile:** https://colosseum.com/arena/projects/sonar-for-panta (account GreYat_Labs)

## Superteam Earn — Panta API Side Track

Listing and form: https://superteam.fun/earn/listing/panta-api-side-track (deadline 13 October 2026 06:59 UTC, editable until then). Use greatojies@gmail.com.

- **Project Name:** Sonar for Panta
- **Project Description:**

  Sonar for Panta is a signal desk built on the Panta API. It reads the trades on every Panta market, calls a side with reasons a user can check, and lets them act on it from their own wallet.

  The problem: the Panta API gives an integrator a price and a trade list. It does not give price history, a read on who is buying, or any sense of whether a market is cheap or expensive. Traders and creators work blind, so thin markets stay thin.

  How the Panta API is used. Fourteen endpoints are integrated across the whole lifecycle:
  - Discovery and data: GET /markets/ across every status and category, GET /markets/{id}/, GET /markets/{id}/trades/, GET /categories/.
  - Trading: primaryorderquote, primaryorderbuild, primaryordersubmit, primaryorderverify, then POST /trades/ so every trade is attributed back to Panta.
  - Positions and claims: GET /positions/, POST /claim/build/, creator-fee claims.
  - Market creation: /markets/create/quote/, /build/ and /register/.

  Every write is non-custodial. Panta builds the transaction, the user's wallet signs, Sonar broadcasts and reports the signature. The API key never reaches the browser. "Powered by Panta" is on every page.

  What Sonar adds on top of the API:
  - A signal for each market from its own trades (flow, momentum, large prints, wallet concentration), with the reasons shown.
  - Price history, which the API does not provide, recorded every 10 minutes.
  - The full trade record rebuilt from the Solana program log where the trades endpoint returns nothing, which is the case for most resolved markets.
  - A price check against Polymarket and Kalshi for the same question.
  - A Create page that turns a headline into a complete market with a resolution rule, plus a weekly Nigeria board: the naira, inflation, the CBN rate, the NGX index, the Super Eagles and petrol. All six specs have been through Panta's sandbox create flow.
  - A sandbox mode, so anyone can try the full trade and create flow with an empty wallet.

  Evidence that it works: a walk-forward replay over 124 resolved Panta markets, with no look-ahead, made 68 calls and 41 were right (60%). Every call is public on the Agent page. The engine behind it has 672 scored signals on Kalshi and Polymarket at 57.7%. The repo is MIT licensed with 34 automated tests and CI.

  Feedback for the Panta team: 17 API issues found during the build are written up with reproductions in docs/PANTA-API-FEEDBACK.md.

- **Project Github Link:** https://github.com/G-ojies/sonar-panta
- **Project Website:** https://sonarpanta.xyz
- **Project X Link:** https://x.com/Great_ojies/status/2103387182601994515
- **Link to your pitch deck or Loom/video presentation:** https://sonarpanta.xyz/pitch (swap in the new 2-minute pitch video once recorded; the old Loom says Lagos and carries the old Nigeria claim)
- **Did you submit this project to the official Crypto World's Fair on Colosseum? (Yes/No):** Yes
- **Link to Colosseum project:** https://colosseum.com/arena/projects/sonar-for-panta
- **Link to your project's Colosseum profile:** https://colosseum.com/arena/projects/sonar-for-panta

## X launch thread (draft)

1. Prediction markets did $44.8B in a month this June. Almost none of it on-chain. Panta put permissionless markets on Solana behind an API; we built the brain for it. Meet Sonar for Panta. (radar screenshot)
2. Every Panta market, scored from its own tape and priced against Polymarket and Kalshi. Example: Panta 50¢, Polymarket 13¢, no prints. That's a 37-point gap sitting in the open. (market screenshot)
3. Quote, sign in your wallet, broadcast, attributed back to Panta. Non-custodial end to end. Claim winnings in one click.
4. Nigeria has 60M bettors and no venue where anyone can create a market on a Nigerian data release. The Create page ships starter boards: CBN, NBS inflation, naira, NGX, Super Eagles. Creators earn fees on every trade. (create screenshot)
5. An agent paper-trades every call and settles against Panta's own resolutions. Track record in the open, plus a print-by-print replay over resolved Panta markets. (agent screenshot)
6. Open source (MIT), 14 Panta endpoints, 17 API issues filed for the Panta team. Built for @ColosseumOrg's Crypto World's Fair, the @SuperteamNG track and the @PantaHQ side track. Live: (URL) · Code: github.com/G-ojies/sonar-panta

## Superteam Earn — RPC Fast Infrastructure Sidetrack

Listing and form: https://superteam.fun/earn/listing/colosseum-crypto-worlds-fair-hackathon-rpc-fast-infrastructure-sidetrack (deadline 13 October 2026 06:59 UTC; 21 winners, prize is RPC Fast credits worth about $499 each, not cash). Use greatojies@gmail.com.

Before the Earn form, the listing's own conditions (all on the owner):

1. Follow https://x.com/rpcfast from @Great_ojies.
2. Join Telegram https://t.me/rpc_fast and Discord https://discord.com/invite/WYMDrbfUhq.
3. Fill the RPC Fast application form for the free Focus plan (two months). Prefilled link, two fields left to type (the RPC Fast account email, and the Discord account name):
   https://docs.google.com/forms/d/e/1FAIpQLSeZtDvOIwkT9IsVlXmbSLRfzOb6QjBY9AAL63dpWVGnUMONxw/viewform?usp=pp_url&entry.169818151=Sonar+for+Panta&entry.1052243141=https%3A%2F%2Fsonarpanta.xyz&entry.286099501=https%3A%2F%2Fx.com%2FGreat_ojies&entry.713214246=https%3A%2F%2Fcolosseum.com%2Farena%2Fprojects%2Fsonar-for-panta&entry.1807832504=Not+needed+for+now.+Sonar+holds+one+logsSubscribe+WebSocket+on+the+Panta+program+%28about+ten+transactions+a+day%29+plus+JSON-RPC+for+tape+rebuilds%3B+the+Focus+plan+covers+it.+If+we+add+a+second+high-volume+program+we+would+ask+for+Yellowstone+gRPC.&entry.90959516=Telegram+%40G_Ojies&entry.1869970843=%40Great_ojies&entry.1489054157=%40G_Ojies&entry.982375277=Yes
4. Put the API key from the RPC Fast dashboard (solana.rpcfast.com, Products, Default project) into Render as `RPCFAST_API_KEY`, redeploy, and check `curl -s https://sonarpanta.xyz/api/health | jq .chain.paths` reads `RPC: RPC Fast, stream: RPC Fast, history: Solami` (the Solami key already on Render answers the months-back reads, because RPC Fast's nodes keep about a day of ledger; see docs/RPCFAST.md).
5. Two to three public posts a month about RPC Fast in October and November (plan in docs/WEEKLY-UPDATES.md).

Earn form answers:

- **Project Name:** Sonar for Panta
- **Project Description:** Sonar for Panta is the intelligence and execution layer for on-chain prediction markets on Solana. It scores every Panta market from its own trade tape, prices each question against Polymarket and Kalshi, lets users trade non-custodially from their own wallet, drafts new markets from a headline (starting with a weekly Nigeria board), and runs an autonomous agent that keeps a public track record with a walk-forward replay over resolved markets. Infrastructure use: Panta's API returns no trades for most resolved markets and for every graduated one, so Sonar rebuilds each market's tape from the program's own log on chain, and RPC Fast is the chain data path for that. One RPC Fast key carries both paths: JSON-RPC (getSignaturesForAddress + getTransaction) rebuilds tapes, paced to the plan's rate, and one logsSubscribe WebSocket on the Panta program streams live prints so a trade reaches Sonar seconds after it confirms instead of on the next 10-minute scan. Every plan including Start has WebSocket access, so both paths run on RPC Fast from the first key; a refused key moves that path to the public fallback for 30 minutes and the health API says which provider each path is on. The integration is documented in docs/RPCFAST.md with plan limits and the compute-unit budget (about 1 CU per call, a few thousand calls a day), covered by 71 tests, MIT licensed, and live at sonarpanta.xyz. Built by the team behind Sonar (sonar.nodalytics.xyz), a live signal engine on Kalshi/Polymarket with 672 resolved signals at a 57.7% 30-day win rate.
- **Project Github Link:** https://github.com/G-ojies/sonar-panta
- **Project Website:** https://sonarpanta.xyz
- **Project X Link:** https://x.com/Great_ojies/status/2103387182601994515
- **Link to your pitch deck or Loom/video presentation:** https://www.loom.com/share/64fdea3e83e147ee865af08b016792fa (deck: https://sonarpanta.xyz/pitch)
- **Did you submit this project to the official Crypto World's Fair Hackathon on Colosseum? (Yes/No):** Yes (Crypto World's Fair, Solana track, country: Nigeria)
- **Link to Colosseum project:** https://colosseum.com/arena/projects/sonar-for-panta
- **Link to your project's Colosseum profile:** https://colosseum.com/arena/projects/sonar-for-panta (account GreYat_Labs)

## Sonar Curve side tracks (Meteora DBC, Adevar Labs, CertiK), all due 13 October 2026 06:59 UTC

All three use the same 9-field Earn form. Use greatojies@gmail.com. Colosseum allows one project per builder, so Curve is entered as a module of Sonar for Panta; say so plainly.

Shared fields:

- **Project Name:** Sonar for Panta (Sonar Curve module)
- **Project Github Link:** https://github.com/G-ojies/sonar-panta (program in `onchain/`, Curve data path in `src/lib/dbc.ts`, docs in `docs/CURVE.md` and `docs/CURVE-PROGRAM.md`)
- **Project Website:** https://sonarpanta.xyz/curve
- **Project X Link:** https://x.com/Great_ojies/status/2103387182601994515
- **Link to your pitch deck or Loom/video presentation:** https://sonarpanta.xyz/pitch (swap in the 60-second Curve clip from docs/VIDEOS.md once recorded)
- **Did you submit this project to the official Crypto World's Fair Hackathon on Colosseum? (Yes/No):** Yes (Crypto World's Fair, Solana track, country: Nigeria)
- **Link to Colosseum project:** https://colosseum.com/arena/projects/sonar-for-panta
- **Link to your project's Colosseum profile:** https://colosseum.com/arena/projects/sonar-for-panta (account GreYat_Labs)

### Meteora DBC: Project Description

Sonar Curve is a data stream and a market primitive built directly on Meteora's Dynamic Bonding Curve.

The data stream. Sonar decodes DBC from the chain with no SDK and no indexer: the program's `emit_cpi!` events (EvtInitializePool, EvtSwap2, EvtCurveComplete) are read from inner instructions, and VirtualPool and PoolConfig accounts are decoded from the IDL. For every launch it follows, Sonar shows the price along the curve (from sqrt_price in Q64.64), the quote raised, progress to the config's migration threshold, the status (trading, complete, migrated) and the prints behind it. It is served as a page at sonarpanta.xyz/curve and as JSON at /api/curve/launches and /api/curve/pool/<address>, so a trading terminal or launchpad can plug it in. Any pool can be opened by address. The index is sampled and bounded and costs about 0.2 GB a month on the wire; the method and measurements are in docs/CURVE.md.

The market primitive. `curve_market` is an Anchor program for parimutuel YES/NO markets on whether a DBC pool graduates before a deadline. It resolves by reading the pool account itself (finish_curve_timestamp and is_migrated), so there is no oracle, no admin key and no fee. Launch communities get a way to put a price on conviction, and creators get a public signal of how likely their curve is to fill. It is deployed on devnet and was run end to end with real signatures: open a market, YES and NO stakes from two wallets, a resolve refused before the deadline, resolved after it, winner paid, loser's rent recovered. The program has 45 tests (LiteSVM) and a written threat model.

Honest status: the program is on devnet; the live site shows the markets panel read-only until the mainnet deploy. The Curve data path runs on mainnet today. It sits inside Sonar for Panta, a live prediction-market signal desk on Solana (open source, MIT).

### Adevar Labs: Project Description

Sonar Curve's `curve_market` is a Solana/Rust (Anchor) program for parimutuel YES/NO markets on whether a Meteora DBC token launch graduates before a deadline. Users stake SOL on YES or NO; at the deadline anyone can resolve the market by passing the pool account, and the program reads graduation straight from that account, so there is no oracle, no admin key and no fee. Winners claim pro rata; losers recover their rent.

Why a pre-audit matters here: the program holds user stakes in escrow and its security rests on reading a foreign program's account correctly (owner and discriminator checks, fixed offsets into a bytemuck layout, deadline and double-claim handling). The threat model, invariants and test map are in docs/CURVE-PROGRAM.md; 45 LiteSVM tests cover the paths. About 793 lines of program code and 1,213 lines of tests. Deployed on devnet at DPsFa2nxH568WZdeAgmdaxBrS3Je4UK4K7axxzCYAqjp and run end to end with real signatures. A pre-audit is the step before the mainnet deploy.

It is part of Sonar for Panta (MIT, public repo), which also decodes the DBC event stream and pool accounts for a public launch index at sonarpanta.xyz/curve.

### CertiK: Project Description

Sonar for Panta is an open-source signal and trading desk for on-chain prediction markets on Solana, live at sonarpanta.xyz. Its new module, Sonar Curve, adds a program that holds user funds.

Problem and users: prediction-market traders and token-launch communities have no honest, oracle-free way to price whether a launch will succeed. Target users are traders on Panta and Meteora DBC launch communities, starting with Nigeria through Superteam Nigeria.

Program to audit: `curve_market` (Anchor, Rust), parimutuel YES/NO markets on whether a Meteora DBC pool graduates before a deadline, resolved from the pool account with no oracle or admin key. About 793 lines of program code, 1,213 lines of tests (45 LiteSVM tests), threat model in docs/CURVE-PROGRAM.md. Devnet: DPsFa2nxH568WZdeAgmdaxBrS3Je4UK4K7axxzCYAqjp. Target mainnet launch: after an audit, aiming for Q4 2026.

Roadmap, 6 to 12 months: (1) Q4 2026: audit and mainnet deploy of curve_market; markets panel live on sonarpanta.xyz; support for Meteora's TransferHookPool accounts. (2) Q1 2027: weekly Nigeria market boards on Panta, an embeddable Radar widget, and a Sonar Pro API for terminals and bots. (3) Q2 to Q3 2027: on-chain market making for thin Panta markets, more launch venues for Curve, and partnerships with Nigerian creators and communities. No token launch is planned.

Team: Great Ojietohamen, founder and sole engineer (Rust, Anchor, TypeScript), X @Great_ojies, GitHub G-ojies, based in Benin City, Nigeria. Core team: one person. (CONFIRM: full-time or part-time.)

Fundraising: bootstrapped, no outside funding and not raising now; plans to apply for ecosystem grants and to raise a pre-seed after mainnet traction.

Contact for a scoping call: Telegram @G_Ojies or greatojies@gmail.com.

## Superteam Earn: AkcaVPN credits (Akca Network), due 13 October 2026 06:59 UTC

Listing: https://superteam.fun/earn/listing/crypto-worlds-fair-project-for-akcavpn-credits (Global, 10 winners, prize is AkcaVPN credits, not cash). 8 fields:

- **Project Name:** Sonar for Panta
- **Project Description:** Sonar for Panta is an open-source signal and trading desk for on-chain prediction markets on Solana. It scores every Panta market from its own trade tape, prices it against Polymarket and Kalshi, and lets users trade, claim and create markets non-custodially from their own wallet. A new module, Sonar Curve, decodes Meteora DBC token launches and adds an oracle-free Anchor program for markets on whether a launch graduates. Live at sonarpanta.xyz, MIT licensed.
- **Project Website:** https://sonarpanta.xyz
- **Project X Link:** https://x.com/Great_ojies/status/2103387182601994515
- **Link to Colosseum project:** https://colosseum.com/arena/projects/sonar-for-panta
- **Where does your team work from, and how (remote, co-located, travelling):** Solo builder working remotely from Benin City, Nigeria, coordinating online with Superteam Nigeria for pitch reviews and demo day, and travelling to events when possible.
- **Why does a private connection matter for your team?:** I deploy programs and sign transactions from the same laptop I use on shared and public networks, so a private connection protects deploy keys, API keys and wallet sessions. Nigerian networks are also unreliable and occasionally restricted, and a connection that keeps working helps me ship and pitch on time.
- **A brief description of your team (Name - Role, X link):** Great Ojietohamen - Founder and engineer, https://x.com/Great_ojies
