#!/usr/bin/env bash
# Build and publish WhoHasAccess to Cloudflare Pages by hand (Direct Upload).
# Not needed when the Pages project is connected to this repo: then every push to main deploys.
# Run from the repo root on a machine with Node 22 and a Cloudflare login
# (`npx wrangler login`), or with CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID set.
# Set VITE_GOOGLE_CLIENT_ID=<your client id> to bake it in (it is public, not a secret);
# leave it unset and visitors paste their own Client ID in the app.
# Security headers come from client/public/_headers (copied into dist/ by the build).
set -euo pipefail

PROJECT=${PROJECT:-wha}
export VITE_GOOGLE_CLIENT_ID="${VITE_GOOGLE_CLIENT_ID:-}"
[ -n "$VITE_GOOGLE_CLIENT_ID" ] || echo "Note: VITE_GOOGLE_CLIENT_ID is not set; visitors will be asked to paste a Client ID." >&2

npm ci --no-audit --no-fund
npm run build
test -f dist/_headers || { echo "dist/_headers is missing; refusing to publish without security headers" >&2; exit 1; }

W="npx --yes wrangler@4"
# First run only: create the project (the error on later runs is "already exists").
$W pages project create "$PROJECT" --production-branch main >/dev/null 2>&1 || true
$W pages deploy dist --project-name "$PROJECT" --branch main --commit-dirty=true

echo "Published to Cloudflare Pages project '$PROJECT'."
echo "Custom domain (once): Pages → $PROJECT → Custom domains → add your domain (Cloudflare adds the CNAME)."
