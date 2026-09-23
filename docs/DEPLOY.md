# Deploying Sonar for Panta

Three moving parts: the Next.js app (Vercel), a Redis store (Upstash), and a scheduled job that refreshes the radar and runs the agent (GitHub Actions). Total cost on free tiers: $0.

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

`vercel.json` also declares two crons (`/api/refresh` every 10 min, `/api/agent` twice an hour). On the Hobby plan Vercel only runs crons daily, so the GitHub Actions job below is the primary scheduler; the Vercel crons are a harmless extra on Pro.

## 3. Scheduler (GitHub Actions)

`.github/workflows/sonar-tick.yml` runs `npm run agent` every 10 minutes: refresh radar (~90 s of rate-limited Panta calls), settle and open paper positions, and re-run the backtest every sixth tick. It writes straight to Upstash, so the Vercel functions stay light.

```bash
gh secret set PANTA_API_KEY      --body "pk_live_..."
gh secret set KV_REST_API_URL    --body "https://....upstash.io"
gh secret set KV_REST_API_TOKEN  --body "..."
gh secret set SOLANA_RPC         --body "https://..."      # optional
gh workflow run sonar-tick                                  # first tick now
```

Set the repository variable `SONAR_AGENT_MODE=live` plus a secret `SONAR_AGENT_KEYPAIR` (JSON array) only if you want the agent to place real primary buys.

## 4. Check

```bash
curl https://<project>.vercel.app/api/health
# {"ok":true,"store":"redis","panta":"ok:active","radarMarkets":64,...}
```

Then open `/`, `/agent`, and `/pitch`. The pitch deck reads its traction numbers from the same store.
