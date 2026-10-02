# Sonar Curve: plan (2 October 2026)

Why: three Crypto World's Fair side tracks close on 13 October and none fits Sonar as it is. Colosseum allows one project per builder, so the new work ships as a module of the Sonar for Panta submission, not as a second project.

| Track | What it judges | What Sonar Curve gives it |
| --- | --- | --- |
| Meteora DBC (20,000 USDC) | Depth of Meteora integration, execution, originality beyond the meme-stock meta, impact, mainnet traction | A live tape and graduation signals for DBC launches, decoded from the program's own events, plus on-chain graduation markets that resolve from the DBC pool account itself |
| Adevar Labs pre-audit (5 x $4,000, in kind) | Solana/Rust submissions; codebase complexity and clarity, repository completeness, launch readiness | A Rust program with tests, a threat model and invariants written down |
| CertiK audit credits (10 x 10,000 USDG, in kind) | Value at risk, technical maturity, roadmap, codebase quality | The same program, which holds user stakes, with a roadmap to mainnet |

## The product

**Graduation markets.** Every Meteora DBC launch has one question built into it: will this pool reach its migration threshold and graduate to DAMM v2 before a date? Sonar Curve lets anyone open a parimutuel YES/NO market on a DBC pool, stake the pool's quote token (SOL or USDC) on a side, and claim a pro-rata share of the losing side when it resolves. Resolution needs no oracle: the program reads the pool's `VirtualPool` account (`is_migrated`, `finish_curve_timestamp`, `quote_reserve` against the config's `migration_quote_threshold`). Curve complete or migrated before the deadline resolves YES; the deadline passing first resolves NO.

**Curve tape.** The same decoder approach Sonar uses on Panta, pointed at DBC: `EvtInitializePool`, `EvtSwap2` and `EvtCurveComplete` from the program log give a per-pool tape (price along the curve, quote raised, progress to graduation, trade count, largest prints). Shown on a `/curve` page and served as JSON for terminals.

## Pieces

1. **Program** `curve_market` (Anchor, Rust) in `onchain/`. Instructions: `create_market(pool, deadline)`, `stake(side, amount)`, `resolve()`, `claim()`, `refund()` (one side empty). Reads the DBC pool account (program `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN`, same id on devnet and mainnet; `VirtualPool` discriminator `[213,224,5,209,98,69,119,92]`). No admin key, no upgrade path in the logic, u128 math, PDA vault per market. Tests with crafted pool accounts. Deployed to devnet first; mainnet needs about 2 SOL of rent, which is a decision for the owner.
2. **Decoder and page** in the Next app: `src/lib/dbc.ts` (event decoding from the IDL), `/api/curve/launches`, `/api/curve/pool/[id]`, and `/curve` (launch list with graduation progress and the market panel). Wallet flows reuse the existing adapter.
3. **Docs**: `docs/CURVE-PROGRAM.md` (accounts, instructions, invariants, threat model, test map), `docs/CURVE.md` (product, API, how to run), roadmap and the three side-track form answers in `docs/SUBMISSION.md`.

## Boundaries

Zero spend beyond devnet. No token, no fees in v1. The Panta product is untouched. Same writing rules as the rest of the repo: plain sentences, no em dashes, say traders or creators and never bettors.
