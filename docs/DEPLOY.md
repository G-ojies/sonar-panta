# Deploying Sonar for Panta

Three moving parts: the Next.js app (Vercel), a Redis store (Upstash), and a scheduled tick that refreshes the radar and runs the agent (an external pinger hitting `/api/agent`, with GitHub Actions as fallback). Total cost on free tiers: $0.

## 1. Redis (Upstash)

Create a free Redis database at https://console.upstash.com (or install the Upstash integration from the Vercel Marketplace, which injects the two variables below into the Vercel project automatically). Note:

- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`

Seed it with the history collected locally so the deployment does not start empty:

```bash
KV_REST_API_URL=... KV_REST_API_TOKEN=... npx tsx scripts/store-sync.ts .sonar-store.json
```

## 2. Vercel

```bash
vercel login
vercel link            # create project "sonar-panta"
vercel env add PANTA_API_KEY production        # pk_live_...
vercel env add PANTA_API_BASE_URL production   # https://live-api.panta.market/api/v1
vercel env add KV_REST_API_URL production
vercel env add KV_REST_API_TOKEN production
vercel env add CRON_SECRET production          # any long random string
vercel env add NEXT_PUBLIC_SOLANA_RPC production   # a mainnet RPC (Helius/Triton free tier is fine)
vercel env add NEXT_PUBLIC_SITE_URL production     # https://<project>.vercel.app
vercel env add ANTHROPIC_API_KEY production        # optional: Claude drafting on /create
vercel --prod
```

`vercel.json` declares one daily cron (`/api/refresh` at 06:00 UTC) as a last-resort fallback: the Hobby plan rejects anything more frequent.

## 3. Scheduler

One tick = refresh the radar (~90 s of rate-limited Panta calls), settle and open paper positions, and re-run the backtest every sixth tick. It has to run every 10 minutes for the Radar to stay current and the agent's record to grow. Two ways to drive it; use the first.

### 3a. External pinger → `POST /api/agent` (primary)

The route answers `202` immediately and finishes the tick in the background (`waitUntil`), holds a 4-minute lock so overlapping pings are ignored, and needs only `CRON_SECRET`. Any free pinger works; [cron-job.org](https://cron-job.org) is the simplest.

| Field | Value |
| --- | --- |
| URL | `https://<project>.vercel.app/api/agent` |
| Method | `POST` |
| Header | `Authorization: Bearer <CRON_SECRET>` |
| Schedule | every 10 minutes |

Check it by hand:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<project>.vercel.app/api/agent
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
curl https://<project>.vercel.app/api/health
# {"ok":true,"store":"redis","panta":"ok:active","radarMarkets":64,...}
```

Then open `/`, `/agent`, and `/pitch`. The pitch deck reads its traction numbers from the same store.
