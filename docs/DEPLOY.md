# Deploying Sonar for Panta

Three moving parts: the Next.js app (a Render free web service defined in `render.yaml`, served at https://sonarpanta.xyz), a Redis store (Upstash), and a scheduled tick that refreshes the radar and runs the agent (an external pinger hitting `/api/agent`, with GitHub Actions as fallback). Total cost on free tiers: $0.

## 1. Redis (Upstash)

Create a free Redis database at https://console.upstash.com (or install the Upstash integration from the Vercel Marketplace, which injects the two variables below into the Vercel project automatically). Note:

- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`

Seed it with the history collected locally so the deployment does not start empty:

```bash
KV_REST_API_URL=... KV_REST_API_TOKEN=... npx tsx scripts/store-sync.ts .sonar-store.json
```

## 2. Hosting on Render

`render.yaml` at the repo root is a Render Blueprint: one free web service running `next start`. Because it is a long-lived Node process there is no function time limit, so the 90-second tick behind `POST /api/agent` simply runs to completion, and the same 10-minute pinger that drives it keeps the free instance from sleeping.

1. Render dashboard → New → Blueprint → pick the GitHub repo. Render reads `render.yaml` and creates the service.
2. Fill the secret env vars it asks for: `PANTA_API_KEY`, `PANTA_TEST_API_KEY`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `CRON_SECRET`, `NEXT_PUBLIC_SOLANA_RPC` (and `ANTHROPIC_API_KEY` if you want Claude drafting). The non-secret ones are in the blueprint.
3. First deploy takes about five minutes. Check `https://<service>.onrender.com/api/health`.
4. Custom domain. Register `sonarpanta.xyz` (Cloudflare Registrar or Porkbun; .xyz is a few dollars the first year) and put its DNS on Cloudflare. Render service → Settings → Custom Domains → add `sonarpanta.xyz` and `www.sonarpanta.xyz`. In Cloudflare DNS add: an **A** record, name `@`, value `216.24.57.1` (Render's apex address), and a **CNAME**, name `www`, target `sonar-panta.onrender.com`; both with the proxy **off** (DNS only) so Render can issue the certificates. Render verifies within a few minutes and serves HTTPS on both; `www` redirects to the apex. `NEXT_PUBLIC_SITE_URL` in the blueprint already points at this hostname.
5. Point the pinger (section 3a) at `https://sonarpanta.xyz/api/agent`.

Render redeploys on every push to `main` (`autoDeploy: true`).

## 3. Scheduler

One tick = refresh the radar (~90 s of rate-limited Panta calls), settle and open paper positions, and re-run the backtest every sixth tick. It has to run every 10 minutes for the Radar to stay current and the agent's record to grow. Two ways to drive it; use the first.

### 3a. External pinger → `POST /api/agent` (primary)

The route answers `202` immediately and finishes the tick in the background (`waitUntil`), holds a 4-minute lock so overlapping pings are ignored, and needs only `CRON_SECRET`. Any free pinger works; [cron-job.org](https://cron-job.org) is the simplest.

| Field | Value |
| --- | --- |
| URL | `https://sonarpanta.xyz/api/agent` |
| Method | `POST` |
| Header | `Authorization: Bearer <CRON_SECRET>` |
| Schedule | every 10 minutes |

Check it by hand:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://sonarpanta.xyz/api/agent
# {"ok":true,"started":true,"runs":18}   then /api/health shows a fresh radarUpdatedAt ~90 s later
```

### 3b. GitHub Actions (fallback)

`.github/workflows/sonar-tick.yml` runs `npm run agent` on a `*/10` cron and writes straight to Upstash. **GitHub throttles scheduled workflows on free repositories: in practice this job fires every 3 to 5 hours, not every 10 minutes** (measured 23 to 25 Sep 2026). Keep it as a fallback and for `gh workflow run sonar-tick` on demand.

```bash
gh secret set PANTA_API_KEY      --body "pk_live_..."
gh secret set KV_REST_API_URL    --body "https://....upstash.io"
gh secret set KV_REST_API_TOKEN  --body "..."
gh secret set SOLANA_RPC         --body "https://..."      # optional
gh workflow run sonar-tick                                  # one tick now
```

Set the repository variable `SONAR_AGENT_MODE=live` plus a secret `SONAR_AGENT_KEYPAIR` (JSON array) only if you want the agent to place real primary buys.

## 4. Check

```bash
curl https://sonarpanta.xyz/api/health
# {"ok":true,"store":"redis","panta":"ok:active","radarMarkets":64,...}
```

Then open `/`, `/agent`, and `/pitch`. The pitch deck reads its traction numbers from the same store.
