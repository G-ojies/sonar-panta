# GitLab "Life After Code" (Transcend): Devpost answers

Deadline 27 October 2026, 13:00 UTC. Target date to submit: 25 October. No pushes to the GitLab project after the deadline.

## Fields

- **Project name:** Sonar Guard
- **Tagline:** GitLab Duo agents run everything after the merge for a live prediction-market desk, and are never allowed to touch the money.
- **Path / category:** Path B: Bring Your Own, Best Supervised Agent. Also entered for Most Stages Covered.
- **GitLab project (public, MIT):** https://gitlab.com/gitlab-ai-hackathon/transcend-october-2026/43258699/sonar-guard
- **Pipeline history:** https://gitlab.com/gitlab-ai-hackathon/transcend-october-2026/43258699/sonar-guard/-/pipelines
- **Deployed project:** https://sonarpanta.xyz (deployed by the GitLab pipeline since 11 October)
- **Original MIT project:** https://github.com/G-ojies/sonar-panta
- **Demo video (YouTube, under 3 min):** https://youtu.be/d5VJ4AQwz6I
- **Google Cloud bonus:** not claimed (deployed on Render's free tier)
- **Most Environmentally Impactful:** not opted in
- **Built with:** gitlab-duo-agent-platform, gitlab-ci, gitlab-releases, gitlab-container-registry, gitlab-package-registry, gitlab-sast, next.js, typescript, upstash-redis, anchor, rust, solana, render

## Description

### What it does

Sonar is a live signal desk for Panta, a prediction market on Solana. It scans every market and calls a side, and it publishes a walk-forward track record that has to stay honest. It also has `curve_market`, an Anchor program that holds user stakes in escrow.

That means two things can go wrong in production: the public numbers can quietly go stale or shrink, and a program change can lose people's money. Sonar Guard is the post-code lifecycle I built on GitLab to cover both. Agents handle the work after the merge. They can't change the program, and they can't approve their own work.

One issue goes through all nine stages:

| Stage | What runs |
| --- | --- |
| Plan | **Triage** (custom flow, on issue created) labels risk and area, writes acceptance criteria and decides whether an agent may build it |
| Create | Triage's builder agent opens a merge request for low-risk web changes. Program changes always go to a person |
| Verify | `test:web` (typecheck, lint, 135 tests, JUnit report) and `test:program` (`cargo build-sbf` plus the LiteSVM program tests) |
| Secure | SAST, secret detection, dependency scanning, plus **Anchor Review** (custom flow, on MR created), which checks any `onchain/` diff against the program's written invariants and posts line-level findings. It can never approve |
| Package | Container image to the Container Registry; `curve_market.so` and its SHA-256 to the Package Registry |
| Configure | A `production` environment, masked CI variables and a Render deploy hook split so the key can be masked |
| Release | Release notes and a tagged GitLab Release, created only after the live checks pass |
| Monitor | **Guard** checks the live site after every deploy and every 3 hours: health, the deployed commit, database, radar freshness, radar size, and whether the track record shrank. If a check fails, **Watch** (custom flow, on pipeline failed) opens an incident with the evidence and a revert MR. On success, **Ship Report** (on pipeline passed) posts "Shipped in vX and verified live" on the MR and its issue |
| Govern | CODEOWNERS on `onchain/` and the pipeline file. Agents never see the deploy key (protected variables only), have no wallet or program keys, and only push `guard/*` branches. Every run leaves an issue or note behind |

### Why I built it

On 6 October, Sonar went down for two hours. The database hit its free-plan command limit, and nothing noticed until users did. The record on the site had stopped updating, and no check was watching for it. Guard's checks come straight from that incident. They test the specific ways this product fails, not just whether the server answers.

### What happened when I ran it (all on the live site, 11 to 13 October)

1. **Issue #1**, "show the hit rate in the radar header." Triage labeled it `area::web` / `risk::low` and wrote six acceptance criteria. The builder opened **MR !1**, and the MR pipeline passed. I merged it. The pipeline deployed it, Guard verified the live commit, and **release v1.0.12** was published. Ship Report posted the verified result. The site now shows "45 of 77 calls right (58%)".
2. **Breaking it on purpose.** In **MR !2** I removed two fields from the health response. Anchor Review correctly said there were no program changes. After the merge, Guard **failed** on radar freshness and radar size, and the release was blocked. Watch opened **incident #2** with the failing checks and the right cause, plus **revert MR !3**. I merged the revert, and production recovered on the next pipeline.
3. **A dangerous program change.** **MR !4** rounds winner payouts up so winners "never lose a fraction of a base unit." The change sounds harmless.
   - **Anchor Review** rated it **critical**. It worked through a 100/200 vs 100 market that pays out 134 + 267 = 401 from a 400 vault. In that market, the last winner's claim reverts, and with no admin key their funds are stuck for good. It also named the two existing tests the change breaks, and the property test that's missing.
   - `test:program` failed on that same invariant.
   - **Watch** then opened !5 as a diagnosis-only MR. It explained the failure and recommended a fix for a person to apply, but didn't patch program code itself.
   - I closed both unmerged. Nothing reached main or the chain.

### How I used GitLab

- **Duo Agent Platform:** four custom flows (`.gitlab/duo/flows/`): Triage, Anchor Review, Watch and Ship Report. Each is triggered by a project event: work item created, MR created/ready, pipeline failed, pipeline passed. They were created through the AI Catalog GraphQL API and enabled per project.
- **CI/CD:** `.gitlab-ci.yml` with test, package, secure, deploy, monitor and release stages. There's also a scheduled pipeline every 3 hours that runs only the monitor and security jobs.
- **Releases, Container Registry, Package Registry, Environments, CODEOWNERS** and the SAST, Secret Detection and Dependency Scanning templates.

### What I added during the submission period (Path B)

The original project (github.com/G-ojies/sonar-panta, MIT) is the Sonar web app and the `curve_market` program. Everything below was written on or after 10 October, and the first GitLab deployment was on 11 October:

- `.gitlab-ci.yml`, `Dockerfile`, `.gitlab/CODEOWNERS`
- `src/lib/guard.ts`, `scripts/guard/monitor.ts` and `tests/guard.test.ts` (the live checks and their tests)
- `scripts/guard/release-notes.mjs`
- the four Duo flows in `.gitlab/duo/flows/`
- `SONAR_READ_ONLY` mode and the `commit` field on `/api/health`
- `docs/GITLAB.md` (runbook)
- the deployment: production (sonarpanta.xyz) is now built and deployed from this GitLab project by the pipeline

The data cron stays on GitHub. Two writers to the same database is what caused the 6 October outage, so the GitLab side deploys and watches but never writes.

### Challenges

- The Duo sandbox can't install one of Sonar's npm packages (registry 403). So agents don't claim tests passed. They hand verification to the MR pipeline, which is where it should happen anyway.
- Bot-opened MRs don't trigger other flows. So Anchor Review runs on MRs opened by people, which matches the risk: agents can't open program MRs.
- The flow validator only accepts a subset of keys, so the flows route on one-word final answers.
- As a Developer on the hackathon group, I can't protect the environment or require code-owner approval. I've requested Maintainer. Until it's granted, the human gate on `onchain/` is enforced by CODEOWNERS, the flows' own rules, and the fact that no agent holds a key that could deploy the program.

### What's next

- Protected `production` environment and required code-owner approval once Maintainer is granted.
- Run Anchor Review against the program's real devnet upgrade checklist before any mainnet deploy of `curve_market`.
