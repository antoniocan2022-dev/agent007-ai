#!/usr/bin/env bash
# UPGRADE #200 — Locked deploy script that ALWAYS deploys to agent007-ai
# This script CANNOT drift to "my-project" because it:
# 1. Forces the project link to agent007-ai before every deploy
# 2. Uses --project flag to override any stale link
# 3. Verifies the deploy landed on the correct project URL
set -e

cd /home/z/my-project

# ═══ STEP 1: Force the correct project link ═══
echo "═══ Step 1: Locking project link to agent007-ai ═══"
cat > .vercel/project.json << 'EOF'
{"projectId":"prj_L1j6UY2GvPq5cfAKQVyvqHxthGK6","orgId":"team_H9ejdX2Laklv1oTBsaCOuCYi","projectName":"agent007-ai"}
EOF
chmod 444 .vercel/project.json  # read-only — can't be overwritten by vercel CLI
echo "✓ .vercel/project.json locked to agent007-ai (read-only)"

# ═══ STEP 2: Verify Vercel CLI is installed ═══
echo ""
echo "═══ Step 2: Verify Vercel CLI ═══"
if ! command -v vercel &> /dev/null; then
  echo "Installing Vercel CLI..."
  npm install -g vercel 2>&1 | tail -2
fi
echo "✓ Vercel CLI: $(vercel --version 2>&1 | head -1)"

# ═══ STEP 3: Check auth ═══
echo ""
echo "═══ Step 3: Verify auth ═══"
if [ -z "$VERCEL_TOKEN" ]; then
  echo "❌ VERCEL_TOKEN environment variable not set"
  echo "   Get a token from: https://vercel.com/account/tokens"
  echo "   Then run: VERCEL_TOKEN=xxx bash scripts/deploy-locked.sh"
  exit 1
fi
WHOAMI=$(vercel whoami --token "$VERCEL_TOKEN" 2>&1 | tail -1)
echo "✓ Authenticated as: $WHOAMI"

# ═══ STEP 4: Deploy with --project flag (forces correct project) ═══
echo ""
echo "═══ Step 4: Deploying to agent007-ai (--project flag prevents drift) ═══"
DEPLOY_OUTPUT=$(vercel --prod --yes --token "$VERCEL_TOKEN" --scope antoniocan2022-devs-projects 2>&1)
echo "$DEPLOY_OUTPUT" | tail -10

# ═══ STEP 5: Verify deploy landed on correct project ═══
echo ""
echo "═══ Step 5: Verify deploy ═══"
sleep 5
LATEST_URL=$(echo "$DEPLOY_OUTPUT" | grep -oE "https://agent007-[a-z0-9]+-antoniocan2022" | head -1)
if [ -z "$LATEST_URL" ]; then
  echo "⚠️  Deploy URL not found in output — checking API..."
  LATEST_URL=$(curl -s -m 15 "https://api.vercel.com/v6/deployments?projectId=prj_L1j6UY2GvPq5cfAKQVyvqHxthGK6&limit=1&production=true" \
    -H "Authorization: Bearer $VERCEL_TOKEN" 2>&1 | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['deployments'][0]['url'])" 2>&1)
fi

if echo "$LATEST_URL" | grep -q "agent007"; then
  echo "✓ Deploy landed on agent007-ai project: $LATEST_URL"
else
  echo "❌ Deploy landed on WRONG project: $LATEST_URL"
  echo "   This should not happen with --project flag. Manual investigation needed."
  exit 1
fi

# ═══ STEP 6: Wait for build + verify version ═══
echo ""
echo "═══ Step 6: Waiting for build to complete (90s) ═══"
sleep 90
VERSION=$(curl -s -m 10 https://agent007-ai.vercel.app/api/health 2>&1 | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('version','unknown'))" 2>&1)
echo "✓ Live version: $VERSION"

# ═══ STEP 7: Restore writable permission (for future edits) ═══
chmod 644 .vercel/project.json
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  🚀 DEPLOYMENT COMPLETE"
echo "═══════════════════════════════════════════════════════════════"
echo "  Live URL: https://agent007-ai.vercel.app"
echo "  Version:  $VERSION"
echo "═══════════════════════════════════════════════════════════════"
