# Sonar Guard on GitLab: setup runbook

The post-code lifecycle for Sonar, built for the GitLab "Life After Code" hackathon (Path B, from the MIT
project at github.com/G-ojies/sonar-panta). The pipeline is `.gitlab-ci.yml`; the agent flows are in
`.gitlab/duo/flows/`; the live checks are `src/lib/guard.ts` + `scripts/guard/monitor.ts`.

## What covers each lifecycle stage

| Stage | Where |
| --- | --- |
| plan | Triage flow: labels, risk and acceptance criteria on every new issue |
| create | Triage flow's builder agent opens an MR for low-risk web changes |
| verify | `test:web` (typecheck, lint, 135 tests, JUnit report), `test:program` (cargo build-sbf + LiteSVM tests); Watch flow proposes a fix MR when they fail |
| package | `package:image` (container registry), `package:program` (curve_market.so + SHA-256 in the package registry) |
| secure | SAST, secret detection, dependency scanning; Anchor Review flow on every MR that touches onchain/ |
| release | `release:notes` + `release:create`, only after the live checks pass |
| configure | `production` environment, protected CI variables, Render deploy hook |
| monitor | `monitor:post-deploy` and `monitor:scheduled` (Guard checks); Watch flow opens an incident and a revert MR; Ship Report flow posts the verified result |
| govern | CODEOWNERS approval on onchain/ and the pipeline, protected environment, agent tool governance, no program keys in CI |

## One-time setup (after the contributor onboarding is approved)

1. **Import.** In the hackathon group: New project > Import project > Repository by URL >
   `https://github.com/G-ojies/sonar-panta.git`. Public visibility. Check the MIT license shows in the About panel.
2. **CODEOWNERS.** Already set to `@G-ojies` in `.gitlab/CODEOWNERS`.
3. **Protected branch.** Settings > Repository > Protected branches > main: allowed to push = no one
   (merge only), and turn on "Require approval from code owners".
4. **Render service** (a second free web service, separate from sonarpanta.xyz):
   - New Web Service, connect the GitLab project, branch main, same build/start commands as `render.yaml`.
   - **Auto-deploy off.** The pipeline deploys.
   - Env vars: copy from the sonarpanta service, then set **`SONAR_READ_ONLY=1`**. That turns off the scan, the
     agent tick and the live tape stream on this instance, so it never becomes a second writer to Upstash (the cause
     of the 6 Oct outage). Do not just drop CRON_SECRET: without it those routes accept anyone. Leave out
     RPCFAST_API_KEY (public RPC is enough).
   - Settings > Deploy Hook: copy the URL.
5. **CI/CD variables** (Settings > CI/CD > Variables, all protected; mask the hook):
   - `RENDER_SERVICE_ID`: the `srv-...` part of the deploy hook.
   - `RENDER_DEPLOY_KEY`: the `key=` part of the deploy hook (masked; GitLab cannot mask the whole URL because of the `?`).
   - `GUARD_BASE_URL`: the service URL, for example `https://sonar-guard.onrender.com`.
6. **Environment.** Operate > Environments > production. Settings > CI/CD > Protected environments: protect
   production; the deploy is allowed for maintainers only.
7. **Schedule.** Build > Pipeline schedules > New: every 3 hours, target main, variable `GUARD_SCHEDULE=monitor`.
8. **Flows.** AI > Flows > New flow, once for each file in `.gitlab/duo/flows/` (paste the YAML, visibility
   Private). Enable each with its trigger:

   | Flow | Trigger event | Action |
   | --- | --- | --- |
   | Sonar Triage | Work item | Created |
   | Sonar Anchor Review | Merge request | Created, Marked ready |
   | Sonar Watch | Pipeline events | Failed |
   | Sonar Ship Report | Pipeline events | Passed |

   Also enable the foundational **Code Review** flow (reviewer assignment) and keep **Fix CI/CD Pipeline**
   available from the pipeline page.
9. **Agent tool governance.** In the group's GitLab Duo settings, restrict what flows can run. They never get the
   deploy hook (protected variables only reach protected-branch jobs, and agents work on guard/* branches).

## Still to check once access is live

- Whether the Render deploy hook honours `&ref=<sha>`. If it doesn't, the hook deploys the branch head, which
  is the same commit for a default-branch pipeline. The monitor waits for the exact commit either way.
- Whether `Jobs/Dependency-Scanning.gitlab-ci.yml` is the current template name on GitLab.com (ci_linter will say).
- That `RENDER_GIT_COMMIT` is set on the new service (it is on git-backed Render services), so `/api/health` reports `commit`.
- The GitLab Credits allowance for flows on the hackathon group.

## Demo script (under 3 minutes)

1. Open an issue ("Show the hit rate on the radar header"). Triage labels it web/low and opens an MR.
2. The MR pipeline runs; Anchor Review says no program change; Code Review comments.
3. Merge. Deploy, the live Guard checks, a release with notes, and Ship Report's note on the MR.
4. Break it on purpose (an MR that drops the radar from the health response). Guard fails after the deploy,
   Watch opens an incident with the table and a revert MR. Approve the revert, and it's green again.
5. An MR that touches `onchain/`: Anchor Review posts findings, and the merge button waits for a person.
