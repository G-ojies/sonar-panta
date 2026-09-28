# Sonar for Panta — video scripts

Colosseum wants two videos: a **pitch** (≤ 3 min allowed, 2 min advised: team, problem, why, market, traction) and a **technical demo** (2–3 min). The Panta and Superteam Nigeria side tracks accept a Loom or the deck at `/pitch`. Record both with Loom, screen + voice, 1080p. **Switch the header toggle to Sandbox before recording the trade, claim and create steps**: Panta's fixtures answer every call, nothing is sent on chain, and an empty wallet is enough. Say so on camera; judges reward honesty about what is live. For the Superteam NG pitch reviews (three are required, plus demo day) present `/pitch` with the arrow keys; every number on the traction slide is read live from the store.

## Pitch (2:00)

About 260 spoken words, which is 1:50 at a normal pace and leaves ten seconds of slack. Colosseum asks for team, problem, why, market and traction; each is marked below. Say "traders" and "creators". The record numbers move every day: read them off the live Agent page on the day you record and change the script to match.

| Time | On screen | Say |
| --- | --- | --- |
| 0:00 to 0:15 | You on camera, or deck slide 1 | **Team.** "I'm Great, a solo engineer in Benin City, Nigeria. I run Sonar, a signal engine for prediction markets. On Kalshi and Polymarket it has made 672 scored calls, and 57.7 percent were right." |
| 0:15 to 0:35 | Deck slide 2 (problem) | **Problem and market.** "Prediction markets traded over 40 billion dollars in June. Very little of that is on Solana. Panta is changing this with an API that lets anyone create and trade a market. But the API gives you a price and nothing else. No history. No read on who is buying. Traders and creators work blind." |
| 0:35 to 1:05 | Live site: Radar, then click into one market and point at the reasons and the trade panel | **Product.** "Sonar for Panta fixes that. It reads every trade on every Panta market, rebuilding the record from the Solana chain where the API has gaps. It calls a side and gives reasons you can check. It compares each price with Polymarket and Kalshi. And you can trade from the same screen, with your own wallet." |
| 1:05 to 1:25 | Live site: Agent page, replay record | **Traction.** "Does it work? I replayed it over 124 resolved Panta markets, with no look-ahead. It made 68 calls and 41 were right. That is 60 percent. Every call is public, and the code is open source, with tests." |
| 1:25 to 1:45 | Live site: Create page with a Nigeria board question loaded | **Why Nigeria.** "Nigerians argue about the naira, inflation and the Super Eagles every week. Local venues prove the demand, but they write every market themselves. With Sonar, anyone can create one, with a clear rule for how it settles. Six are ready this week." |
| 1:45 to 2:00 | Deck slide 10, URL visible | **Business and close.** "Sonar will earn creator fees on the markets it lists and a share of the trades it routes. Next is a paid signal feed for bots and apps. Sonar is live now at sonarpanta.xyz." |

### Before you record

- Full-screen browser, no bookmarks bar, no Loom bubble over the content. Hide the bottom ticker.
- Open the four tabs in order first: deck, Radar, Agent, Create. Switching tabs is faster than typing addresses.
- Pick the market for the product section in advance: one with a clear side and at least two reasons showing.
- One take is fine. If you stumble, pause, then repeat the whole sentence so it can be cut cleanly.
- Rename the Loom before sharing. The automatic titles have been wrong every time.

### If a judge asks

- **"What happens when Panta builds its own analytics?"** Sonar owns what Panta will not build: the comparison with other venues, a public scored record, and the Nigerian market specs. The engine can read another Solana venue.
- **"Bayse already does Nigerian markets."** Yes, and that proves the demand. Bayse writes its own markets and holds naira. Sonar lets anyone create one, settles in USDC, and never holds funds.
- **"Is 60 percent good?"** It is a small sample and I report it as it is. Medium-confidence calls are 12 of 24. The point is that the record is public and replayable, which no other entry offers.

## Technical demo (2–3 min)

1. **Architecture (20s).** Server-side Panta client with a rate limiter and typed errors; radar refresh (list × status × category → detail → tape → venue match → snapshot → signals) on a cron; Upstash for persistence; every write is quote → build → sign in wallet → broadcast on our RPC → submit/register → report for attribution.
2. **Radar (30s).** Filters: Open / Tradable / Cross-venue / Resolved. Point at score bars, confidence dots, venue gap column.
3. **Market page (40s).** Sonar read with reasons; sparkline built from our own snapshots ("Panta has no price history endpoint, so we record one"); cross-venue block; resolution rule from `onChain`; tape with Solscan links. Trade panel (sandbox on): get quote (show shares, expiry), Sign & buy, the sandbox signature Panta returns, the "attributed" badge. Say: "Same code path on mainnet, the wallet signs the built instructions and we broadcast."
4. **Portfolio + claim (20s).** Positions marked to live prices; Claim button builds `claim_win_usdc` via the API.
5. **Create (30s, sandbox on).** Click a Nigeria starter (CBN) → draft → quote (50 USDC fee split shown, not paid) → Sign & create → registered fixture id.
6. **Agent (20s).** Paper positions, settlement log, backtest table. Mention `SONAR_AGENT_MODE=live`.
7. **Feedback (10s).** Flash `docs/PANTA-API-FEEDBACK.md` (14 items) and `docs/BUSINESS-PLAN.md`.

Keep the "Powered by Panta" badge visible in every shot.
