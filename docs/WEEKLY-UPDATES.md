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

"Sonar for Panta, week three. Since last time: [pick three of] the pitch and demo videos are up; the first Nigeria starter markets were drafted through the Create flow; the agent has now settled N paper calls against Panta's resolutions, here is the record [show Agent]; feedback from the Superteam Nigeria pitch review led to [change]. Next: final submission on 6 October and the Superteam NG demo day."

## Week 4 (from 9 October, final)

"Final update. Sonar for Panta is submitted. Numbers as of today: N markets tracked, N agent calls settled, hit rate N percent, N API issues filed. Everything is open source under MIT, deployed on free tiers, with zero spend. What I'd build next with support: live agent capital, secondary-market support the day Panta ships it, and the embeddable radar for creators. Thank you for reviewing."
