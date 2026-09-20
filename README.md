# Sonar for Panta

**Behavioural signals, cross-venue pricing and one-click non-custodial trading for [Panta](https://panta.market) prediction markets on Solana.**

Built for the Panta API side track of Colosseum's Crypto World's Fair. _Powered by Panta._

Sonar already runs live on Kalshi and Polymarket (sonar.nodalytics.xyz: 672 resolved signals, 57.7% 30-day win rate). This repo brings the same engine to Panta's on-chain markets through the Panta API, and adds what Panta itself does not expose: price history, tape analytics, and a price check against the two largest off-chain venues.

## What it does

| Surface | Panta API calls | What you get |
| --- | --- | --- |
| **Radar** (`/`) | `GET /markets/` × status × category, `GET /markets/{id}/`, `GET /markets/{id}/trades/` | Every open market scored from its own tape: flow imbalance, 24h momentum, whale prints, wallet concentration, velocity, staleness, plus the same question's price on Polymarket / Kalshi. |
| **Market** (`/market/{id}`) | detail + tape, `POST /primaryorderquote/`, `/primaryorderbuild/`, `/primaryordersubmit/`, `/primaryorderverify/`, `POST /trades/` | Sonar read with reasons, price sparkline from our snapshots, cross-venue gap, resolution rule, full tape, and a quote → sign → broadcast → report buy panel. |
| **Portfolio** (`/portfolio`) | `GET /positions/`, `GET /markets/{id}/`, `POST /claim/build/`, `POST /trades/` (kind claim) | Positions marked to live prices, claim winnings in one click, attribution reported back. |
| **Create** (`/create`) | `POST /markets/create/quote/`, `/build/`, `/register/` | Headline / URL → Claude drafts a resolvable YES/NO market → edit → quote fee → sign → register. |
| **Agent** (`/agent`) | everything above, unattended | Paper (or live, with a server keypair) positions on every medium+ call, settled on resolution; plus a backtest over resolved Panta markets. |

Every write is non-custodial: Panta builds instructions, the user's wallet signs, we broadcast on our RPC and file the signature back to Panta for attribution.

## Run it

```bash
cp .env.example .env.local   # add PANTA_API_KEY (pk_live_ for real data, pk_test_ for the sandbox)
npm install
npm run snapshot             # one radar refresh (≈100 s: 2 API calls per market, rate-limited)
npm run agent                # one agent tick (refresh + open/settle paper positions + backtest)
npm run dev                  # http://localhost:3000
```

Optional env: `KV_REST_API_URL`/`KV_REST_API_TOKEN` (Upstash, for persistence on Vercel), `ANTHROPIC_API_KEY` (Claude drafting; falls back to a template), `CRON_SECRET` (protects `/api/refresh` and `/api/agent`), `SONAR_AGENT_MODE=live` + `SONAR_AGENT_KEYPAIR` (JSON secret key) to execute real primary buys.

`vercel.json` schedules the radar every 10 minutes and the agent twice an hour.

## How the signal is built

For each market Sonar pulls the last 200 prints and computes, on the last 24h (or last 20 prints when thin):

- **flow imbalance** — YES share flow minus NO share flow, over total;
- **momentum** — YES price now vs our oldest snapshot inside 24h (Panta has no history endpoint, so Sonar records its own every 10 min);
- **whale share** and **wallet concentration** (HHI) — how much of the tape is one print / one wallet;
- **velocity** and **staleness** — prints per hour, seconds since the last print;
- **cross-venue gap** — Polymarket/Kalshi YES price for the best-matching question (token Dice similarity with a number-match bonus) minus Panta's.

Composite score in −100..100 = 0.45·gap + 0.25·flow + 0.2·momentum + 0.1·whale (weights shift to flow when no venue match), then discounted for thin, stale or single-wallet tape and zeroed after close. |score| < 12 is FLAT; ≥ 45 with ≥ 5 prints is high confidence.

The **backtest** replays the first 60% of each resolved market's tape through the same function and compares the call with Panta's outcome. It is small (Panta's API surfaces a few dozen resolved markets with tape) and reported as-is.

## Panta API notes

See [docs/PANTA-API-FEEDBACK.md](docs/PANTA-API-FEEDBACK.md) for the twelve issues and gaps found during the build, with reproductions.

## Stack

Next.js 14 (app router) · TypeScript · Tailwind · `@solana/wallet-adapter` · `@solana/web3.js` · Upstash Redis (optional) · Anthropic SDK (optional).

## Disclosure

The signal design comes from Sonar, the author's existing prediction-market product on Kalshi/Polymarket (closed source, off-chain). Everything in this repository was written for the hackathon window, from scratch, against the Panta API.
