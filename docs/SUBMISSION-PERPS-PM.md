# Submission draft: Solana Perps & Prediction Markets hackathon

Hackathon: https://hackathons.solana.com/hackathons/perps-and-prediction-markets (deadline 5 December 2026).
Tracks: main track, plus the sponsor bounty "Best use of the pm-AMM" (PREDICT Spark).

Fill the bracketed numbers from `GET https://sonar-markets.vercel.app/api/graduation/traders` and
`/api/graduation` on the day of submission. Do not round up and do not count the keeper or test wallets
(the endpoint already leaves them out).

## Name

Sonar Graduation Markets

## One-liner

Prediction markets on whether a token launch graduates from its bonding curve, priced by pm-AMM and
resolved by reading the pool itself: no oracle, no admin key.

## The problem

Every day thousands of tokens launch on bonding curves (Meteora DBC, pump-style launchpads). The one
question everyone in a launch is asking is "will this curve fill before it dies?" Today the only way to
express that view is to buy the token itself, which mixes the bet with everything else about the token.

Prediction markets could price that question directly, but two things have kept them away from it:

1. **Resolution.** Most on-chain prediction markets let one key decide the winner. pm-AMM's own mainnet
   notes list centralised resolution as its first accepted risk. For thousands of small, short markets a
   human resolver does not scale and is not trusted.
2. **Liquidity.** Launch markets are many, short-lived and thin. Nobody runs an order-book market maker
   on a six-hour question about a token that did not exist this morning.

## What we built

- **`grad_resolver`, an Anchor program on devnet** (`73G7X9FKEgTtNQMBWGsCGZfHHBpvVxsJ9kqvV6mvubJH`). It opens a
  pm-AMM market whose authority is a PDA of our program, seeds its liquidity, and binds it to one DBC pool
  and a deadline. Nobody, including us, can resolve it by hand:
  - `halt` (permissionless) pulls all of the PDA's liquidity the moment the pool account shows the answer
    (curve complete) or the deadline passes, so nobody can trade on a result that is already known.
  - `resolve` (permissionless, after pm-AMM's `end_ts`) reads the DBC pool account and resolves YES if the
    curve completed, NO otherwise.
  - `settle` (permissionless) redeems the PDA's winning tokens and returns the seed plus the creator fees
    to whoever opened the market.
- **A keeper** (GitHub Actions) cranks every market that is due and opens new markets on the launches
  closest to graduating.
- **A web app** (https://sonar-markets.vercel.app/graduation): live markets with the pm-AMM price next to
  the pool's curve progress, buy/sell YES and NO, claim, a one-click devnet faucet, a form to open a market
  on any pool, and a "First 50 traders" board read from chain.
- **Tests:** 12 LiteSVM tests run `grad_resolver` against the real pm-AMM program binary (dumped from
  mainnet, where its build matches devnet): creation with the PDA as authority, trading and creator fees, halt refused while open and
  allowed on every completion signal, informed buys refused after halt, resolution both ways, foreign
  pools refused, settle returning seed and fees.

## Why the pm-AMM

We tried the alternatives first, so this is not a guess.

- **Parimutuel (our first version, `curve_market`).** Simple and safe, but there is no price until the end
  and no way out before the deadline. Traders cannot take profit when a curve stalls, and the market says
  nothing useful while it runs. pm-AMM gives a live probability and an exit at any time.
- **Order book.** Needs market makers on every market. For hundreds of short, thin launch markets they do
  not exist. pm-AMM turns one seed deposit into a full price curve from 0 to 1.
- **Constant-product AMM.** Liquidity sits in the wrong place for an outcome that converges to 0 or 1, and
  LP losses to informed flow grow as the deadline approaches, exactly when launch outcomes become obvious.
- **LMSR.** Bounded loss, but static liquidity and a subsidy the creator pays up front; it does not adapt
  to time.
- **pm-AMM (dynamic).** Liquidity scales with the square root of the time left, which is what the Paradigm
  paper shows keeps the LP's expected loss rate uniform in both price and time. That suits a question with
  a hard deadline: the pool is deep early, when the outcome is uncertain, and thins as it approaches the
  answer. We set pm-AMM's `end_ts` to the market deadline so this schedule matches the question.

pm-AMM leaves one thing to the integrator: who decides the outcome and when liquidity stops being exposed.
That is the part we built. Because the market authority is a PDA that can only act on what the DBC pool
account says, the "centralised resolution" risk goes away for this whole class of questions, and the halt
closes the window where an informed trader could drain the pool after the answer is visible on chain.

The PDA is also the market creator, so it earns the creator half of pm-AMM's 2% swap fee. That is the
business model: protocol-owned liquidity that earns fees and cannot be rugged by a resolver key.

## Depth of integration

pm-AMM is the whole trading layer, not a side feature: market creation, liquidity, every trade, the price
shown, the halt (LP withdrawal), resolution and settlement all go through pm-AMM instructions, called by CPI
from `grad_resolver` with the PDA as signer. Every account offset and discriminator is checked against the
pm-AMM IDL in tests. Measured costs: `open_market` about 660k compute units (pm-AMM's first deposit is over
400k), a swap about 560k, `halt` 95k, `resolve` 18k, `settle` 89k.

## Product today (works end to end on devnet)

- Program deployed, keeper running, web app live.
- Full lifecycle proven on devnet: open on a pool at 99.6%, trade, halt, resolve NO from the pool account,
  settle 102.91 mUSDC to the opener against a 100 mUSDC seed (102.84 winning NO plus 0.07 creator fees).
- [N] markets opened so far, [N] resolved, [N] live at submission.

## Traction (from chain, outside wallets only)

| Metric | Value |
| --- | --- |
| Wallets that traded | [traders] |
| Trades | [trades] |
| Volume | [volume] mUSDC |
| Creator fees earned by market PDAs | [fees] mUSDC |
| Markets opened | [markets] |

How we got them: [X posts, Superteam Nigeria, testers; fill in honestly].

## Why now, and what comes next

Launchpads are where most new Solana users meet on-chain trading, and graduation is the moment they all
watch. A market that prices it, resolves itself and pays fees to protocol-owned liquidity can run on every
launch without a team approving each one.

After the hackathon:
1. Mainnet with real USDC on a small set of launches, keeper on a dedicated server.
2. Market selection from Sonar Curve's momentum signal (which launches are a real question).
3. Embeddable widget for launchpads: "Will this graduate?" next to the buy button.
4. The same resolver pattern for other on-chain-observable questions (TVL thresholds, vote outcomes).

## Links

- Live app: https://sonar-markets.vercel.app/graduation
- Repository: https://github.com/G-ojies/sonar-panta (program in `onchain/programs/grad_resolver`)
- Program: `73G7X9FKEgTtNQMBWGsCGZfHHBpvVxsJ9kqvV6mvubJH` (devnet)
- Demo video: [link]
- Built by GreYat Labs (@Great_ojies), also behind Sonar (sonar.nodalytics.xyz).
