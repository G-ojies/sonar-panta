# Solami in Sonar

[Solami](https://solami.dev) is the chain data path for Sonar for Panta. Two Solami products do real work here, both behind one API key:

| Solami product | What Sonar uses it for | Code |
| --- | --- | --- |
| **RPC** (`https://rpc.solami.dev/sol`) | Rebuilding a market's trade tape from the Panta program's log: `getSignaturesForAddress` for the market, then `getTransaction` for each print. Also the one `getTransaction` behind every streamed print, and the catch-up after a reconnect. | `src/lib/chain-tape.ts` |
| **WebSocket** (`wss://ws.solami.dev/ws/sol`) | The live tape stream: one `logsSubscribe` filtered to the Panta program, so a trade reaches Sonar seconds after it confirms. | `src/lib/tape-stream.ts` |

`src/lib/solami.ts` turns the environment into the two URLs. With no key, both paths use the public mainnet endpoints, which is how the app ran before and how you can try it today.

## Why this matters for Sonar

Sonar reads a market from its tape. Panta's trades endpoint returns no prints for most resolved markets and for every graduated one ([feedback item 17](PANTA-API-FEEDBACK.md)), so Sonar decodes the tape from the program's own log lines:

```
Primary Order (USDC): side=No, amount=5000000, yes_price=527657993, no_price=472342007, minted=10488508
```

Before this change that decoding ran only inside the scan, about every 18 minutes, against the public RPC. Render's shared address is rate limited there (HTTP 429), so rebuilds were slow and often skipped. Now:

- The rebuild runs on Solami RPC, paced to the plan's request rate.
- The program log is pushed over a WebSocket. When an order line arrives, Sonar fetches that one transaction, decodes it with the same decoder the scan uses, finds its market and appends the print to the market's stored tape. The market page reads that tape on its next refresh, so the Sonar read can move seconds after a trade instead of on the next scan.

## How the stream works

1. One socket, one subscription: `logsSubscribe` with `{ "mentions": ["6gM5afTQBq5VZCfgpGqcsqzfWd5maLSCKWtGjbEobZMp"] }` at `confirmed`. The node does the filtering. Nothing is polled.
2. A frame with an order line costs one `getTransaction` (signer, block time, accounts). Frames without one (market creation, graduation, failed transactions) cost nothing.
3. The print is mapped to its market: the transaction account that the radar's registry knows. For a market created since the last scan, the key in the program's own event is used, and only if the transaction also carries that account.
4. The print is appended to `sonar:chaintape:<market>` in the store, once, however often it arrives.
5. The socket is pinged every 30 seconds and dropped if it stays silent for 75. After a drop it reconnects with backoff (1 s doubling to 60 s, with jitter).
6. After every connect, one `getSignaturesForAddress` on the program, bounded to 50 signatures and ending at the last signature handled, closes the gap. That cursor is saved in the store, so a restarted process picks up where the old one stopped.

### Where the socket lives

Sonar is a single Next.js server process on a Render free web service. There is no worker to give the socket to, so it lives in that process, as one instance shared by every route. The first `/api/health` call after a boot starts it, and Render's own health check makes that call within seconds.

That process can restart on a deploy, or sleep if the pinger stops. The design assumes it will: nothing depends on the socket staying up. The saved cursor and the bounded catch-up recover missed prints on the next start, and the scan's own rebuild stays in place as the backstop. The stream is off on serverless hosts and in one-shot scripts such as the GitHub Actions tick, where a long-lived socket cannot exist; those still use Solami RPC for rebuilds.

### Why `logsSubscribe` and not Mirage

Mirage is Solami's Yellowstone stream over a WebSocket. It sends whole transactions as binary protobuf and draws on prepaid streaming bandwidth. Sonar needs only the log lines of one quiet program, as JSON, and `logsSubscribe` gives exactly that with no extra dependency. It also behaves the same on any Solana RPC, which is what lets the stream fall back to the public endpoint and lets anyone run the project with no key.

### Bandwidth

The Panta program sees about ten transactions a day (70 in the week to 30 September 2026). A notification is about 2 KB and the transaction fetch about 6 KB, so trades cost a few megabytes a month. The keepalive pings are the larger part, an estimated 15 MB a month. Together that is well under one percent of the Render free plan's 5 GB.

## Plans, and what happens on each

The two paths degrade on their own, and the health output always says which provider each one is on.

| Key | Tape rebuild (RPC) | Live stream (WebSocket) | `chain.paths` in `/api/health` |
| --- | --- | --- | --- |
| Dev plan or higher, or a trial | Solami | Solami | `RPC: Solami, stream: Solami` |
| Free plan (RPC at 5 requests a second, no WebSocket) | Solami | public endpoint | `RPC: Solami, stream: public fallback` |
| No key | public endpoint | public endpoint | `RPC: public, stream: public` |
| Key revoked or out of balance | public endpoint | public endpoint | `RPC: public fallback, stream: public fallback` |

Solami answers a WebSocket upgrade with HTTP 400 when the plan has no WebSocket access, and with 401, 402 or 403 when the key is unknown, out of balance or of the wrong type. None of those change on retry, so Sonar moves that path to the fallback endpoint for 30 minutes and then tries Solami again on the next reconnect. Close codes 4002 (bandwidth and balance empty) and 4029 (connection cap reached) are handled the same way. Rate limits (HTTP 429, or JSON-RPC `-32005`) are retried with backoff. RPC calls to Solami are spaced to 4 a second by default, inside the Free plan's 5.

## Environment variables

All of these are read on the server only. The key is never sent to the browser and never printed: health output and logs show the host alone.

| Variable | Needed | Meaning |
| --- | --- | --- |
| `SOLAMI_API_KEY` | for Solami | Your Solami key. Sets both URLs: `https://rpc.solami.dev/sol?api_key=…` and `wss://ws.solami.dev/ws/sol?api_key=…`. |
| `SOLAMI_REGION` | no | `ams`, `fra` or `nyc` pins a region (`fra.rpc.solami.dev`). Leave unset for Solami's global routing. |
| `SOLAMI_RPC_URL`, `SOLAMI_WS_URL` | no | Replace the base URLs. A URL copied whole from the dashboard, key included, is used as given. |
| `SOLAMI_RPS` | no | RPC calls per second sent to Solami. Default 4. Raise it on a paid plan (Dev allows 50). |
| `SONAR_TAPE_STREAM` | no | `off` disables the stream, `on` forces it. Default: on, except on Vercel and during the build. |
| `SOLANA_RPC`, `NEXT_PUBLIC_SOLANA_RPC`, `SOLANA_WS` | no | The fallback endpoints. Default: public mainnet. `SOLANA_WS` defaults to the RPC URL with `wss://`. |

## Run it with your own key

```bash
cp .env.example .env.local      # add PANTA_API_KEY, then SOLAMI_API_KEY=<your key>
npm install
npm run stream                  # watch the stream from a terminal
npm run dev                     # http://localhost:3000
```

Create the key in the Solami dashboard under API keys. A standard key or an RPC key both work for RPC and WebSocket. Do not make it browser-only and do not give it a domain allowlist: Sonar calls Solami from the server, and Solami answers 403 to a browser-only key used from a server.

## See it working

**From a terminal.** `npm run stream` connects the same way the server does and prints what arrives. `--replay N` first pushes the program's last N transactions through the same decode and mapping code, which is useful because the program can go hours without a trade. The script reads the market registry and writes nothing.

```
$ npm run stream -- --replay 6
rpc public (api.mainnet-beta.solana.com), stream public (api.mainnet-beta.solana.com), program 6gM5afTQBq5VZCfgpGqcsqzfWd5maLSCKWtGjbEobZMp
[14:20:05] connect api.mainnet-beta.solana.com
[14:20:08] health  connected=true provider=public host=api.mainnet-beta.solana.com events=0 prints=0 recovered=0 unmapped=0 reconnects=0 lastSlot=451947877
[14:20:08] replay  6 recent program transactions
[14:20:10] print   YES 1.93 shares, YES 51.8c after  market 6yEBmxJu2oWdubFVKZshVVUpLLsXd61csSfmf8y4Qtwd  tx 4B6A7QubiSv6…  from history
[14:20:11] print   YES 9.55 shares, YES 52.0c after  market 6yEBmxJu2oWdubFVKZshVVUpLLsXd61csSfmf8y4Qtwd  tx 4CXwg9y1hfTr…  from history
[14:20:11] print   NO  10.49 shares, YES 52.8c after  market 6yEBmxJu2oWdubFVKZshVVUpLLsXd61csSfmf8y4Qtwd  tx 538WYDNpLZaW…  from history
[14:20:11] health  connected=true provider=public host=api.mainnet-beta.solana.com events=6 prints=3 recovered=0 unmapped=0 reconnects=0 lastSlot=451947877
```

That run was captured on 30 September 2026 with no key, so it shows the public endpoint. With `SOLAMI_API_KEY` set, the first line reads `rpc solami (rpc.solami.dev), stream solami (ws.solami.dev)`.

**From the health API.**

```bash
curl -s https://sonarpanta.xyz/api/health | jq .chain
```

```json
{
  "rpc": { "provider": "public", "host": "api.mainnet-beta.solana.com", "fallback": false },
  "stream": {
    "enabled": true, "connected": true, "provider": "public", "host": "api.mainnet-beta.solana.com", "fallback": false,
    "startedAt": 1790778291, "connectedAt": 1790778292, "lastAliveAt": 1790778292,
    "lastEventAt": null, "lastSlot": 451947877, "lastPrintAt": 1790778293,
    "events": 0, "prints": 0, "recovered": 2, "unmapped": 0, "reconnects": 0, "note": null
  },
  "paths": "RPC: public, stream: public"
}
```

This one is also from a run with no key: a local production build, started with the cursor two trades behind the chain, so the catch-up recovered two prints right after connecting. With a key, `provider` reads `solami`, `host` reads `rpc.solami.dev` and `ws.solami.dev`, and `paths` reads as in the table above.

| Field | Meaning |
| --- | --- |
| `connected` | The socket is open and the node confirmed the subscription. |
| `provider`, `host`, `fallback` | Who carries the stream. `fallback` is true when Solami is configured but the fallback endpoint is in use; `note` says why. |
| `lastAliveAt` | Last frame or pong. Proof of life on a quiet program. |
| `lastEventAt`, `lastSlot` | Last program transaction pushed, and the slot of the newest one seen. |
| `events`, `prints` | Program transactions pushed since start, and the prints decoded from them. |
| `recovered` | Prints picked up by the catch-up after a reconnect or restart. |
| `unmapped` | Orders whose market could not be identified. The next scan reads them. |
| `reconnects` | Times the socket had to be reopened since start. |

**In the app.** Open any market page. Under the "Trade tape" heading one line reports the stream: `Program log streaming live over Solami · last Panta transaction at slot 451,947,877`. Place a trade on Panta and the print appears in the tape on the page's next refresh (every 30 seconds), marked as decoded from the program log when Panta's own endpoint does not return it.

## Tests

`npm test` covers the URL building with and without a key, the refusal and fallback rules, the request pacing, the mapping from a pushed log line to a stored print, the reconnect backoff and the catch-up. No network and no key are needed.

## Left for the owner

1. **Create an API key** in the Solami dashboard (API keys). The account is on the Free plan and has no key yet.
2. **Merge `solami-stream` into `main` and push.** Render deploys `main` on push. With no key set, the site runs as before, on the public endpoints.
3. **Set `SOLAMI_API_KEY` on Render** (service, Environment), let it redeploy, then check `curl -s https://sonarpanta.xyz/api/health | jq .chain.paths`. On the Free plan it should read `RPC: Solami, stream: public fallback`. If the dashboard shows endpoint URLs that differ from the ones in this file, paste them whole into `SOLAMI_RPC_URL` and `SOLAMI_WS_URL`.
4. **Optional:** `gh secret set SOLAMI_API_KEY` so the GitHub Actions fallback tick also rebuilds tapes over Solami.
5. **Claim the Pro trial when you are ready to record, not before.** The signup link (https://solami.dev/signup?ref=st-earn-sep-26) did not switch the account to Pro by itself. Trials are claimed through Solami's Telegram bot, which issues a one-time code that is valid for 15 minutes; redeem it in the dashboard under Trials. Pro runs for 7 days, so claim it shortly before the recording day and well before the deadline of 13 October 2026, 06:59 UTC. Once it is active, restart the service on Render (Manual Deploy, Restart service). The stream only tries Solami again when it next connects, and a restart makes that happen at once. The health line should then read `RPC: Solami, stream: Solami`.
6. **Record the 2 to 3 minute demo against mainnet.** Suggested order: the health output with both paths on Solami; `npm run stream` in a terminal; a small real trade on a Panta market, with the print arriving in the terminal and then on the market page; the plans table above. If no trade is possible on the day, `npm run stream -- --replay 6` shows real transactions going through the same code, and should be described as a replay.
7. **Replace the two captures in "See it working"** with ones from the Solami-backed run, so the samples in this file show Solami hosts.
8. **Fill the Earn form** for the Solami side track. It also asks whether the project was submitted to Colosseum.
9. **After the trial ends** the stream moves to the public fallback without any action and the rebuild stays on Solami RPC. The site keeps working; the health line changes to `stream: public fallback`. Keeping the stream on Solami after that needs the Dev plan.
