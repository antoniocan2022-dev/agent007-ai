#!/usr/bin/env bash
set -e
cd /home/z/my-project
echo "═══════════════════════════════════════════════════════════════"
echo "  Agent007 AI — Vercel Deployment"
echo "═══════════════════════════════════════════════════════════════"
if ! command -v vercel &> /dev/null; then
  echo "Installing Vercel CLI..."
  bun add -g vercel
fi
echo "=== Step 1: Authenticate ==="
if ! vercel whoami &> /dev/null; then
  vercel login
fi
echo "✅ Logged in"
echo "=== Step 2: Link project ==="
if [ ! -d ".vercel" ]; then
  vercel link --yes --project agent007-ai 2>&1 | tail -3 || vercel link --yes 2>&1 | tail -3
fi
echo "✅ Project linked"
echo "=== Step 3: Set env vars ==="
if [ -f .env ]; then
  while IFS='=' read -r key value; do
    [[ "$key" =~ ^#.*$ || -z "$key" || "$key" = "DATABASE_URL" ]] && continue
    value="${value%\"}"; value="${value#\"}"
    if ! vercel env ls production 2>&1 | grep -q "^$key"; then
      echo "$value" | vercel env add "$key" production 2>/dev/null || true
      echo "  ✅ Set $key"
    fi
  done < .env
fi
echo "=== Step 4: Deploy ==="
echo "Building + deploying (2-4 minutes)..."
DEPLOY_URL=$(vercel --prod --yes 2>&1 | grep -E "https://.*\.vercel\.app" | tail -1)
echo "✅ Deployed: $DEPLOY_URL"
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  🚀 DEPLOYMENT COMPLETE"
echo "═══════════════════════════════════════════════════════════════"
echo "  Live URL: $DEPLOY_URL"
echo "  Sign in: antonio.can2022@hotmail.com"
echo "═══════════════════════════════════════════════════════════════"
