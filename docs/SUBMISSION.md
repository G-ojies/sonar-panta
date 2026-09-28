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
