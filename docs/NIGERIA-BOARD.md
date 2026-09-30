# The Nigeria board, week of 28 September 2026

Panta lists no market about Nigeria. This board is six questions Nigerians argue about every week, each written as a complete Panta market: a YES/NO question, a resolution rule that names the exact source and threshold, the sources, a category and the trading and resolution times. They live in `src/lib/boards.ts`, load on `/create` with one click (or `/create?board=<id>`), and are listed on the Radar's Nigeria desk.

All six were run through Panta's create flow in sandbox mode on 27 September 2026 (`npx tsx scripts/board-sandbox.ts`): quote, build and register against the `pk_test_` fixtures. Every one quoted the standard creation fee (50 USDC: 10 seeds the pool, 40 to the platform) and registered. Nothing was sent on chain and no fee was paid. Creating them for real costs 50 USDC each, which is out of scope for this submission.

| id | Question | Category | Trading ends (UTC) | Resolves by (UTC) |
| --- | --- | --- | --- | --- |
| cbn | Will the CBN cut the Monetary Policy Rate again at the 23–24 November 2026 MPC meeting? | finance | 23 Nov 00:00 | 25 Nov 00:00 |
| nbs | Will Nigeria's September 2026 headline inflation print below 15.39%? | finance | 14 Oct 12:00 | 31 Oct 23:59 |
| naira | Will the naira close stronger than ₦1,330 per US dollar on the official market on 30 October 2026? | finance | 30 Oct 12:00 | 31 Oct 12:00 |
| ngx | Will the NGX All-Share Index close October 2026 above 252,113.41 points? | finance | 30 Oct 12:00 | 31 Oct 12:00 |
| eagles | Will Nigeria be ahead of Guinea-Bissau and Madagascar in AFCON 2027 qualifying Group L after matchday 4? | sports | 9 Nov 00:00 | 21 Nov 00:00 |
| petrol | Will Dangote's ex-gantry petrol price be below ₦1,300 per litre on 31 October 2026? | other | 31 Oct 00:00 | 1 Nov 12:00 |

## Where each number comes from

- **CBN.** The MPC cut the MPR by 350 basis points to 23.00% on 22 September 2026, the largest cut in the bank's history, and set the corridor at +50/−300 bps. The next (308th) meeting is scheduled for 23–24 November. Sources: cbn.gov.ng decisions and calendar pages.
- **NBS.** Headline inflation was 15.39% year-on-year in August 2026 (15.43% in July), the third monthly fall; food 19.57%, month-on-month 0.71%. The September report is due around mid-October. Source: nigerianstat.gov.ng.
- **Naira.** NFEM closes in the second half of September: ₦1,329.80 (21 Sep), ₦1,328.00 (23 and 24 Sep), about ₦1,326.06 (25 Sep). Parallel market ₦1,374–1,380. Source: CBN exchange-rate page.
- **NGX.** All-Share Index 252,113.41 on Friday 25 September 2026, market capitalisation ₦163.66 trillion, +62.01% year to date after ten straight gaining sessions. Source: ngxgroup.com.
- **Super Eagles.** AFCON 2027 qualifiers, Group L: Nigeria beat Madagascar 2–1 on 25 September and lost 3–0 away to Guinea-Bissau on 29 September, so Guinea-Bissau lead on six points with Nigeria on three. Tanzania are co-hosts and already qualified; only the best of the other three goes through. Matchdays 3 and 4 are played between 9 and 17 November. Source: cafonline.com, thenff.com.
- **Petrol.** Dangote raised the PMS gantry price from ₦1,265 to ₦1,350 per litre on 12 September 2026 and later trimmed it to ₦1,325. Pump prices: Lagos about ₦1,385, Abuja about ₦1,430. Sources: Dangote Industries, MEMAN.

## What has settled

- **Super Eagles, 29 September (first board).** "Will Nigeria beat Guinea-Bissau in their AFCON 2027 qualifier on 29 September 2026?" would have resolved NO: Guinea-Bissau won 3–0 in Bissau. The slot was rewritten on 30 September as the Group L question above, and the new spec went through the sandbox the same day.

## How the rules are written

Each rule follows the same shape so Panta's oracle can settle it without judgement calls: one named source, one exact threshold or result, a fixed date in UTC, and what happens if the source does not publish (resolves NO). Where two sources could disagree, the rule says which one counts. Thresholds are the last published figure at the time of writing, so each market opens near 50/50.

## Refreshing the board

The board is meant to be rewritten weekly: update the thresholds to the latest print, move the dates, and re-run the sandbox script. The chips on `/create` and the list on the Radar read from the same file, so one edit updates both.
