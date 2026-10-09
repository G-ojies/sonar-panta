# Videos

| Video | Where | Length | Used for |
| --- | --- | --- | --- |
| Demo | https://youtu.be/F6bmSKXT0fg (unlisted) | 2:03 | Colosseum demo-video field, Earn forms |
| Pitch | https://www.loom.com/share/64fdea3e83e147ee865af08b016792fa | 2:36 | Colosseum pitch-video field, Earn forms |
| Week 2 update | https://youtu.be/5IAtZnIBcpU (unlisted) | 0:53 | Colosseum builder update, 25 September |
| Solami demo | https://youtu.be/tlSo74JnBXg (unlisted) | 2:05 | Solami side-track Earn form (9 October, Free plan: stream on public fallback); built by ~/Development/solami-demo-video |
| Week 4 update | https://youtu.be/Qx1EIh8-QMQ (unlisted) | 0:59 | Colosseum weekly video, week 4 (9 October); built by ~/Development/sonar-week4-video |

YouTube descriptions below are paste-ready. Titles first, then the description. Links became clickable once the channel was verified (27 September 2026).

## Demo: youtu.be/F6bmSKXT0fg

**Title:** Sonar for Panta: demo (Crypto World's Fair 2026)

**Description:**

Sonar for Panta is the intelligence and execution layer for on-chain prediction markets on Solana. It scores every Panta market from its own trade tape, prices each question against Polymarket and Kalshi, lets you trade non-custodially from your own wallet, drafts new markets from a headline (starting with a weekly Nigeria board), and runs an autonomous agent that keeps a public track record.

Live app: https://sonarpanta.xyz
Source (MIT): https://github.com/G-ojies/sonar-panta
Pitch deck: https://sonarpanta.xyz/pitch
Agent record: https://sonarpanta.xyz/agent
Colosseum project: https://colosseum.com/arena/projects/sonar-for-panta
Builder: https://x.com/Great_ojies

Recorded in sandbox mode: every trade, claim and market creation runs on Panta's test fixtures, so nothing is sent on chain and no fee is paid. The same code path runs on mainnet with a wallet signature.

Built for the Colosseum Crypto World's Fair (Solana track), the Superteam Nigeria track and the Panta API side track. Powered by Panta: https://panta.market

## Week 2 update: youtu.be/5IAtZnIBcpU

**Title:** Sonar for Panta: week 2 update

**Description:**

Week 2 of building Sonar for Panta for the Crypto World's Fair. What changed: the product went live, the radar keeps a persistent registry so live markets never vanish when Panta's list pages rotate, the cross-venue matcher was rewritten to require a shared subject (no match rather than a wrong match), a sandbox switch runs every write on Panta's test fixtures with an empty wallet, and 14 API issues were filed with the Panta team.

Live app: https://sonarpanta.xyz
Source (MIT): https://github.com/G-ojies/sonar-panta
API feedback: https://github.com/G-ojies/sonar-panta/blob/main/docs/PANTA-API-FEEDBACK.md
Colosseum project: https://colosseum.com/arena/projects/sonar-for-panta
Builder: https://x.com/Great_ojies

Powered by Panta: https://panta.market

## Curve demo: 60-second shot list (to record)

**Title:** Sonar Curve: graduation markets on Meteora DBC launches

Record on devnet (`NEXT_PUBLIC_SOLANA_CLUSTER=devnet`, Phantom set to devnet, about 0.03 SOL in the wallet). Open a market a day ahead before recording so the panel already has odds to show; keep a second market with a deadline a few minutes away for the resolve and claim shots. One take, no cuts needed.

| Time | Shot | Say |
| --- | --- | --- |
| 0:00 | `/curve`: the launch list, progress bars moving, a row with the "1 market" chip | "Sonar Curve follows token launches on Meteora's bonding curve: price, quote raised, how far each one is from graduation, decoded from the program's own events." |
| 0:08 | Click the row; the pool page: price tile, graduation bar, the curve chart, the tape | "Every print on the curve, and the account fields that decide graduation." |
| 0:16 | Scroll to the Graduation market panel; hover the devnet pill | "The question every launch carries: will it graduate before a date? These markets live in a Solana program with no oracle, no admin key and no fee. It is on devnet for now." |
| 0:24 | Pick YES, type 0.01 SOL, Sign & stake; approve in Phantom; the row's odds and your stake update | "Stake the pool's own quote token on a side. SOL is wrapped inside the same transaction." |
| 0:36 | Switch to the short-deadline market; the resolve box appears: "the deadline passed without a fill: resolve settles it NO"; Sign & resolve | "Anyone can resolve once the pool account answers the question. The program reads the DBC pool itself." |
| 0:46 | The claim box: "You can claim 0.004 SOL"; Sign & claim; the transaction link | "Winners split the losing side pro rata and claim in one click. SOL comes back unwrapped." |
| 0:54 | Back to `/curve` with the "settled" chip, then the `/api/curve/markets` JSON in a tab | "All of it is JSON for terminals. Program, tests and threat model are in the repo." |

**Description (paste-ready):**

Sonar Curve adds Meteora Dynamic Bonding Curve launches to Sonar: a live tape per pool decoded from the program's events, graduation progress read from the pool account, and on-chain parimutuel YES/NO markets on whether a curve graduates before a date. The `curve_market` program resolves from the DBC pool account alone, so there is no oracle, no admin key and no fee. Shown on devnet.

Live app: https://sonarpanta.xyz/curve
Program and docs: https://github.com/G-ojies/sonar-panta/tree/main/onchain
Builder: https://x.com/Great_ojies
