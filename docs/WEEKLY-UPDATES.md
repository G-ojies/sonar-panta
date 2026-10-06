# Weekly update videos (Colosseum, judges only, 60 seconds)

Record with Loom or OBS: screen + voice, 1080p, one take. Open the live app first, Sandbox off, Radar tab visible. Speak at a normal pace; 60 seconds is about 150 words.

## Week 2 (submit from 25 September)

Before you start: open https://sonar-panta.vercel.app in a clean tab, no wallet
connected, header chip showing **Mainnet**. Four markets are open right now, all
in Panta's secondary phase with an empty tape, so every Sonar read is FLAT and
the cross-venue column is blank. That is expected; the script leans on it.

"Hi, I'm Great, building Sonar for Panta, the intelligence layer for on-chain
prediction markets on Solana.

What changed this week: the product went live at sonar-panta dot vercel dot
app."

> **Click 1.** You are on Radar (the home page). Point at the four stat tiles:
> Open on-chain, Tradable now, Cross-venue matches, Active calls. Point at the
> "scan ... ago" line top right of the table.

"The radar now tracks every Panta market with a persistent registry, because
Panta's list pages rotate and live markets used to vanish."

> **Click 2.** Click the **Open** filter above the table. Four rows remain.
> Hover the GTA 6 row so it highlights and the full question shows as a tooltip.
> **Click 3.** Click the **Resolved** filter. The 85 rows of history fill the
> table, each with "YES won" or "NO won" in the Closes column. This is what used
> to disappear.

"I rewrote the cross-venue matcher after it paired GTA 6 with a Google Gemini
question; it now needs a shared subject, and reports no match rather than a
wrong one."

> **Click 4.** Click **Open** again, then click the row **"Will GTA 6 release on
> November 19th, 2026"**. The market page opens.
> **Click 5.** Scroll to the panel titled **Same question elsewhere**. Read the
> line on screen: "No close match on Polymarket or Kalshi. This question is
> Panta-only." Point at it while you say "no match rather than a wrong one".
> On the way down you pass the Sonar read (reason: "no prints on the tape
> yet"), the sparkline from our own snapshots, and the resolution rule.

"I added a sandbox switch: every trade, claim and market creation runs on
Panta's test fixtures, so the whole flow can be demoed with an empty wallet."

> **Click 6.** Click the **Mainnet** chip in the header, top right. It turns
> amber and reads **Sandbox**, and an amber banner appears under the header
> saying nothing is sent on chain. Stay on the GTA 6 page.
> **Click 7.** Scroll to the trade panel, which is now unlocked with no wallet.
> Leave YES selected and the default amount. Click **Get a quote**. Shares and
> expiry appear.
> **Click 8.** Click **Sign & buy YES**. The sandbox signature Panta returned
> appears, then the line "Trade reported to Panta (attributed to Sonar)". Say: "Same code path on mainnet; there the
> wallet signs and we broadcast."
> Optional if there is time: click **Create** in the nav, click the **CBN**
> starter, then **Quote** to show the 50 USDC fee split that is not paid.

"And I filed fourteen API issues with the Panta team."

> No click. If asked, the file is docs/PANTA-API-FEEDBACK.md in the public
> repo, linked from "MIT · source" in the footer.

"Next week: the first Nigeria market boards and the demo video. Thanks."

> **Click 9.** Click the **Sandbox** chip once more so it reads **Mainnet**
> before you stop sharing.

If a judge asks why every Sonar read is FLAT: "The four open markets have no
prints yet. Sonar reports flat rather than inventing a lean, the same way the
matcher reports no match rather than a wrong one."

## Week 3 (from 2 October)

Posted 2 October 2026: https://colosseum.com/arena/projects/sonar-for-panta/updates/1004 (with the Solami line and a Sonar Curve mention added), two images, tagged Looking for testers. X reply on the launch thread: https://x.com/Great_ojies/status/2105972184007254527.

Colosseum takes weekly updates as posts on the project's Builder updates feed (one per project per 24 h, 4,000 characters, up to 4 images). Post the text below with two images: `public/screens/agent.png` (the replay record) and `public/screens/create-board.png` (a board loaded on Create in sandbox). Then reply to the X launch thread with the first paragraph and the link.

### Post text

Sonar for Panta, week three.

The agent had run 130 times without a single call, and the reason turned out to be Panta's API, not the engine. The trades endpoint returns no prints for most markets (63 of the 85 resolved ones on the radar, and every graduated market), so Sonar was scoring empty tapes. The Panta program on Solana logs every order it executes, with the exact YES price after each print, so Sonar now reads the tape straight from the program log wherever the API is short. 811 prints across 77 markets came back in one pass, with the one number the API never sends.

That made a real track record possible. The backtest is now a walk-forward replay of the agent's own rule: every resolved market is walked print by print, Sonar is asked for its read after each one, the first non-flat read opens a one-dollar position at the price the chain logged, and it settles against Panta's outcome. No look-ahead. Result as of 30 September: 124 markets, 68 calls, 41 hits (60%), close to break-even per dollar. Both numbers are on the Agent page, row by row.

The first Nigeria board is drafted: six questions Nigerians argue about every week (the CBN rate after the 350-point cut, the September inflation print, the naira, the NGX, the Super Eagles' AFCON qualifying group, the Dangote pump price), each written as a complete Panta market with a rule that names the source and the threshold. One click loads it on Create; all six quoted and registered in Panta's sandbox. The first football question has already settled in the real world: Nigeria lost 3–0 in Bissau on 29 September, so it would have resolved NO, and the slot now asks where Nigeria stands in Group L after matchday 4. Creating them for real is 50 USDC each, so they wait for a creator with capital.

Also this week: feedback item 17 filed with the Panta team (the empty trades endpoint, with the log format an indexer could read), 17 issues in total; the pitch and demo videos are up; the site moved to sonarpanta.xyz.

Next: final submission on 6 October, the Superteam Nigeria pitch reviews and demo day.

### 60-second video script (optional)

"Sonar for Panta, week three. The agent never called because Panta's API returns no trades for most markets, so Sonar now reads the tape from the program log on chain [show a market page: N prints decoded from the program log]. That gave the engine a real record: a print-by-print replay over 124 resolved markets, 41 of 68 calls hit [show Agent]. And the first Nigeria board is drafted, six questions with a rule and a source, one click on Create, all six through Panta's sandbox [show Create with a board loaded]. Next: submission on 6 October and the Superteam Nigeria demo day."

## Week 4 (from 9 October, final)

Post on the Builder updates feed on 9 October with two images: the Curve pool page with the markets panel, and the Agent page. Fill every [bracket] from the live site that morning; do not post a number that was not re-read that day.

### Post text

Sonar for Panta, week four, and the final update.

The project is submitted. Where it stands today: the replay over every resolved Panta market has made [calls] calls on [markets] markets with [hits] right ([rate]%), walking each tape print by print with no look-ahead. [N] tapes come straight from the Panta program log because the API returns none. The live agent has run [runs] times and settled [settled] calls; Panta's catalogue is quiet, so the replay is the honest record.

New this week: Sonar Curve. It follows Meteora Dynamic Bonding Curve launches from the chain alone (events from inner instructions, pool accounts from the IDL) and shows price, quote raised and progress to graduation for [pools] pools at sonarpanta.xyz/curve. Beside it is curve_market, an Anchor program for YES/NO markets on whether a launch graduates before a deadline, resolved by reading the pool account, with no oracle, no admin key and no fee. It runs on devnet with 72 passing tests and a written threat model, and the full flow (open, stake both sides, resolve, claim) has been run with real signatures.

Everything is open source under MIT and runs on free tiers with zero spend. 17 Panta API issues are written up for the Panta team.

What comes next: an audit and the mainnet deploy of curve_market, weekly Nigeria boards created for real, and the embeddable radar for creators. Thank you for reviewing.

## RPC Fast side track posts (October and November)

The side track asks for two to three public posts a month about RPC Fast for two months, from @Great_ojies. Each one states something that is true on the day it goes out; nothing is pre-written as a claim.

| When | Post | Proof to attach |
| --- | --- | --- |
| 30 Sep or 1 Oct | RPC Fast wired in as Sonar's chain data path: one host for JSON-RPC and the logsSubscribe stream, 71 tests, MIT. | Link to docs/RPCFAST.md |
| After the key is on Render (early Oct) | The health line on RPC Fast: `RPC: RPC Fast, stream: RPC Fast`, first prints streamed, reconnects 0. | `/api/health` screenshot, `npm run stream` output |
| Mid Oct (after Earn submission) | What the stream saw in its first two weeks: events, prints, latency from block to tape. | Health counters, a market page |
| Late Oct | Compute-unit use for the month against the plan: real numbers from the Billing and usage page. | Dashboard screenshot |
| Early Nov | Public endpoint vs RPC Fast: how many tape rebuilds a scan completes on each, from the refresh log. | Refresh log lines |
| Mid or late Nov | Feedback for the RPC Fast team: what worked, what was missing, what a small data app needs from an RPC plan. | Thread |

Plus replies and quotes of @rpcfast posts when there is something real to say; the side track counts those too.
