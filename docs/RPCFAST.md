# RPC Fast in Sonar

[RPC Fast](https://rpcfast.com) is a chain data path for Sonar for Panta: one host, `solana-rpc.rpcfast.com` in Frankfurt, answers JSON-RPC over HTTPS and Solana PubSub subscriptions over WebSocket, behind one API key. Two things in Sonar run on it:

| RPC Fast product | What Sonar uses it for | Code |
| --- | --- | --- |
| **Solana RPC** (`https://solana-rpc.rpcfast.com/?api_key=…`) | Rebuilding a market's trade tape from the Panta program's log: `getSignaturesForAddress` for the market, then `getTransaction` for each print. Also the one `getTransaction` behind every streamed print, and the catch-up after a reconnect. | `src/lib/chain-tape.ts` |
| **WebSocket** (`wss://solana-rpc.rpcfast.com/?api_key=…`) | The live tape stream: one `logsSubscribe` filtered to the Panta program, so a trade reaches Sonar seconds after it confirms. | `src/lib/tape-stream.ts` |

`src/lib/chain-endpoints.ts` turns the environment into the two URLs. The same module supports [Solami](SOLAMI.md); RPC Fast is used when `RPCFAST_API_KEY` is set, Solami when only `SOLAMI_API_KEY` is, and the public mainnet endpoints when neither is. That is also how the app ran before either provider existed, and how anyone can try it with no key.

## Why this matters for Sonar

Sonar reads a market from its tape. Panta's trades endpoint returns no prints for most resolved markets and for every graduated one ([feedback item 17](PANTA-API-FEEDBACK.md)), so Sonar decodes the tape from the program's own log lines:

```
Primary Order (USDC): side=No, amount=5000000, yes_price=527657993, no_price=472342007, minted=10488508
```

On the public endpoint that decoding was slow and often skipped: Render's shared address is rate limited there (HTTP 429), so the scan had to be capped at three tape rebuilds per run and the stream shared the same throttled host. With a provider key:

- The rebuild runs on RPC Fast RPC, paced to the plan's request rate (`RPCFAST_RPS`, default 10 a second, inside the Start plan's 15 and the Focus plan's 50).
- The program log is pushed over the RPC Fast WebSocket. When an order line arrives, Sonar fetches that one transaction, decodes it with the same decoder the scan uses, finds its market and appends the print to the market's stored tape. The market page reads that tape on its next refresh, so the Sonar read can move seconds after a trade instead of on the next scan.

Every RPC Fast plan, including the free Start plan, carries WebSocket subscriptions (one concurrent socket on Start, ten on Focus), so unlike Solami's Free plan both paths run on the provider from the first key.

## How the stream works

The stream is the same code whichever provider carries it; the walk-through is in [SOLAMI.md](SOLAMI.md#how-the-stream-works). In short: one socket, one `logsSubscribe` with `mentions` set to the Panta program at `confirmed`; a frame with an order line costs one `getTransaction`; the print is mapped to its market and appended to the stored tape once; the socket is pinged every 30 seconds and reconnected with backoff; after every connect a bounded `getSignaturesForAddress` closes the gap since the last signature handled.

## Plans, and what Sonar costs on them

RPC Fast bills in compute units: one CU per RPC call (`getProgramAccounts` is ten, and Sonar never calls it). WebSocket data is not metered; only the number of open subscriptions is limited, and Sonar holds one.

| Plan | Price | CU a month | RPC rate | WebSockets | What it means here |
| --- | --- | --- | --- | --- | --- |
| Start | free | 1.5M | 15 req/s | 1 | Enough for Sonar as it runs today (see below). |
| Focus | $45 | 12M | 50 req/s | 10 | The plan the hackathon offer grants for two months. Room to raise `CHAIN_TAPES_PER_SCAN` and `RPCFAST_RPS`. |
| Stream | $249 | 60M | 150 req/s | 20 | Adds Yellowstone gRPC. Not needed: Sonar's program sees about ten transactions a day. |

Sonar's RPC use is small and bounded. A scan runs every ten minutes and rebuilds at most `CHAIN_TAPES_PER_SCAN` (default 3) stale tapes; a rebuild is one signature list plus one `getTransaction` per print, and a Panta market has tens of prints, rarely hundreds. Resolved markets are rebuilt once and then kept for 90 days. The stream adds one `getTransaction` per live order and one signature list per reconnect. Taken together that is on the order of a few hundred to a few thousand calls a day, well under the Start plan's 1.5M CU a month; the dashboard's Billing and usage page shows the real number, and `npx tsx scripts/measure-traffic.ts` counts one scan's requests by host.

## Ledger history: the one thing to know

RPC Fast's shared nodes keep about a day of ledger. Measured on 1 October 2026 at 18:30 UTC: `getFirstAvailableBlock` returned slot 452,165,950, and `getSignaturesForAddress` on the Panta program returned 8 signatures, the oldest from 05:39 UTC that morning, where the public endpoint returned a full page of 1,000 reaching back to 15 August. A node without that history answers with the signatures it has and no error, so a tape rebuild for a market older than a day would quietly come back empty.

Sonar handles it in `src/lib/chain-tape.ts`:

- **Probe.** Once an hour the provider is asked for the program's signatures (one call). A full page, or an oldest signature more than a week old, means the node keeps history. RPC Fast does not pass; the public endpoint and Solami do (Solami's `getFirstAvailableBlock` is recent too, but its signature history reaches back, so the probe asks for signatures rather than that slot).
- **Routing.** Reads that go months back, the signature list and the transactions of a tape rebuild, go to the history endpoint when the provider lacks history: Solami if `SOLAMI_API_KEY` is also set, else the public endpoint. The live path stays on RPC Fast: the stream, the one `getTransaction` behind each live print, and the catch-up after a reconnect, all of which sit inside the last day.
- **Safety net.** Every rebuild compares the signatures found with the trade count the chain reports for the market. A provider that comes up short is marked as lacking history for an hour and the rebuild is redone on the history endpoint, whatever the probe said.
- **Health.** `/api/health` reports `chain.history` (provider, host, whether the probe has run, a note), and `chain.paths` names it when it differs: `RPC: RPC Fast, stream: RPC Fast, history: Solami`.

One consequence: after a restart longer than a day, the stream's catch-up cannot see the gap and the scan's rebuild (on the history endpoint) is what closes it, which is what it is there for.

The two paths degrade on their own, and the health output always says which provider each one is on:

| Key | Tape rebuild (RPC) | Live stream (WebSocket) | `chain.paths` in `/api/health` |
| --- | --- | --- | --- |
| RPC Fast, any plan | RPC Fast for recent reads; history over Solami or the public endpoint | RPC Fast | `RPC: RPC Fast, stream: RPC Fast, history: Solami` (or `history: public`) |
| RPC Fast key revoked or out of CU | public endpoint | public endpoint | `RPC: public fallback, stream: public fallback` |
| No key | public endpoint | public endpoint | `RPC: public, stream: public` |

A refusal (HTTP 401, 402 or 403, or 400 on the WebSocket upgrade) will not change on retry, so Sonar moves that path to the fallback endpoint for 30 minutes and then tries RPC Fast again. Rate limits (HTTP 429) are retried with backoff. The key lives in the query string and is never printed: health output and logs show the host alone.

## Environment variables

All of these are read on the server only.

| Variable | Needed | Meaning |
| --- | --- | --- |
| `RPCFAST_API_KEY` | for RPC Fast | The project's API key from the dashboard. Sets both URLs: `https://solana-rpc.rpcfast.com/?api_key=…` and `wss://solana-rpc.rpcfast.com/?api_key=…`. |
| `RPCFAST_RPC_URL`, `RPCFAST_WS_URL` | no | Replace the base URLs. A URL copied whole from the dashboard, key included, is used as given, and the key found in one serves the other. |
| `RPCFAST_RPS` | no | RPC calls a second sent to RPC Fast. Default 10. Raise it on Focus (50 allowed). |
| `CHAIN_PROVIDER` | no | `rpcfast` or `solami`, when both keys are set. Default: RPC Fast, with Solami as the history endpoint. |
| `CHAIN_TAPES_PER_SCAN` | no | Stale tapes rebuilt per scan. Default 3; the Focus plan can take more. |
| `SONAR_TAPE_STREAM` | no | `off` disables the stream, `on` forces it. Default: on, except on Vercel and during the build. |
| `SOLANA_RPC`, `NEXT_PUBLIC_SOLANA_RPC`, `SOLANA_WS` | no | The fallback endpoints. Default: public mainnet. |

## Run it with your own key

```bash
cp .env.example .env.local      # add PANTA_API_KEY, then RPCFAST_API_KEY=<your key>
npm install
npm run stream                  # watch the stream from a terminal
npm run dev                     # http://localhost:3000
```

Create a free account at rpcfast.com (Log In, then the Solana dashboard). The first project is created for you; its API key and both endpoint URLs are on the dashboard under Products. Keep the key out of the browser: Sonar calls RPC Fast from the server only.

## See it working

**From a terminal.** `npm run stream` connects the same way the server does and prints what arrives. `--replay N` first pushes the program's last N transactions through the same decode and mapping code, which is useful because the program can go hours without a trade. With `RPCFAST_API_KEY` set the first line reads `rpc rpcfast (solana-rpc.rpcfast.com), stream rpcfast (solana-rpc.rpcfast.com)`.

**From the health API.** `curl -s https://sonarpanta.xyz/api/health | jq .chain` reports `provider: "rpcfast"` and `host: "solana-rpc.rpcfast.com"` on the RPC and stream paths, the history path beside them, plus the last slot seen, prints streamed, and reconnects. The fields are described in [SOLAMI.md](SOLAMI.md#see-it-working).

**In the app.** Under the "Trade tape" heading on any market page: `Program log streaming live over RPC Fast · last Panta transaction at slot …`.

## Hackathon side track

This integration is Sonar's entry to the RPC Fast infrastructure side track of the Crypto World's Fair (Superteam Earn, deadline 13 October 2026). The side track asks for meaningful use of the infrastructure, a Colosseum submission, and two to three public posts a month about the experience for two months; the posts are listed in [WEEKLY-UPDATES.md](WEEKLY-UPDATES.md).
