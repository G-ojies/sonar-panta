#!/usr/bin/env bash
# One-shot production deploy: link the Vercel project, push every server env var from
# .env.local, deploy, then print the URL. Requires `vercel login` first.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env.local ] || { echo ".env.local missing"; exit 1; }
set -a; . ./.env.local; set +a

vercel link --yes --project sonar-panta >/dev/null
echo "linked"

push() { # push VAR to production+preview, replacing any existing value
  local k=$1 v=${!1:-}
  [ -n "$v" ] || { echo "skip $k (unset)"; return; }
  for env in production preview; do
    vercel env rm "$k" "$env" --yes >/dev/null 2>&1 || true
    printf '%s' "$v" | vercel env add "$k" "$env" >/dev/null
  done
  echo "env $k"
}
for k in PANTA_API_KEY PANTA_TEST_API_KEY PANTA_API_BASE_URL CRON_SECRET NEXT_PUBLIC_SOLANA_RPC NEXT_PUBLIC_SOLANA_CLUSTER SONAR_AGENT_MODE KV_REST_API_URL KV_REST_API_TOKEN ANTHROPIC_API_KEY; do push "$k"; done

URL=$(vercel --prod --yes 2>/dev/null | tail -1)
echo "deployed: $URL"
printf '%s' "$URL" | vercel env add NEXT_PUBLIC_SITE_URL production >/dev/null 2>&1 || true
curl -s --max-time 60 "$URL/api/health"; echo
