# Sonar for Panta — video scripts

Colosseum wants two videos: a **pitch** (≤ 3 min: team, problem, why, market, traction) and a **technical demo** (2–3 min). Panta's side track accepts a Loom. Record both with Loom, screen + voice, 1080p.

## Pitch (≤ 3:00)

**0:00 – 0:20 · Who.** "I'm Great, GreYat Labs, Lagos. I build trading infrastructure on Solana; I run Sonar, a behavioural-signal engine that's been live on Kalshi and Polymarket since mid-2026 — 672 resolved signals, 57.7% 30-day win rate."

**0:20 – 0:50 · Problem.** "Prediction markets are becoming infrastructure. Panta gives any app a market-creation and trading API on Solana. But an API gives you prices, not intelligence: no history, no tape analytics, no idea whether a Panta market is cheap or expensive versus the rest of the world. Traders, creators and bots all fly blind."

**0:50 – 1:30 · Product.** Show Radar. "Sonar for Panta scans every market Panta exposes, scores it from its own trade tape — flow imbalance, momentum, whale prints, wallet concentration — and prices it against Polymarket and Kalshi. Here: Polymarket says 14¢, Panta says 50¢. Click through, see why, buy YES or NO non-custodially through the Panta API, claim winnings, and create new markets from a headline with Claude drafting the resolution rule."

**1:30 – 2:00 · Why it matters / market.** "Panta wants prediction markets embedded everywhere. Every embed needs exactly this layer: what's mispriced, what's moving, what to route flow into. Sonar is that layer, and it's venue-neutral, so it's also the bridge that brings off-chain prediction-market liquidity onto Solana."

**2:00 – 2:40 · Traction.** "Sonar's off-chain track record. On Panta: an autonomous agent that's been paper-trading every medium-plus call since launch, settled against Panta's own resolutions — here's the live scoreboard — plus a backtest over resolved Panta markets. Twelve API issues found and documented for the Panta team."

**2:40 – 3:00 · Ask / next.** "Next: live agent capital, secondary-market support when Panta ships it, and shipping the Radar as an embeddable widget for creators. Sonar for Panta is live at the link below."

## Technical demo (2–3 min)

1. **Architecture (20s).** Server-side Panta client with a rate limiter and typed errors; radar refresh (list × status × category → detail → tape → venue match → snapshot → signals) on a cron; Upstash for persistence; every write is quote → build → sign in wallet → broadcast on our RPC → submit/register → report for attribution.
2. **Radar (30s).** Filters: Open / Tradable / Cross-venue / Resolved. Point at score bars, confidence dots, venue gap column.
3. **Market page (40s).** Sonar read with reasons; sparkline built from our own snapshots ("Panta has no price history endpoint, so we record one"); cross-venue block; resolution rule from `onChain`; tape with Solscan links. Trade panel: get quote (show fee, shares, expiry), sign in Phantom, transaction link, "attributed" badge.
4. **Portfolio + claim (20s).** Positions marked to live prices; Claim button builds `claim_win_usdc` via the API.
5. **Create (30s).** Paste a headline → draft → quote (50 USDC fee split) → sign → registered on Panta.
6. **Agent (20s).** Paper positions, settlement log, backtest table. Mention `SONAR_AGENT_MODE=live`.
7. **Feedback (10s).** Flash `docs/PANTA-API-FEEDBACK.md`.

Keep the "Powered by Panta" badge visible in every shot.
