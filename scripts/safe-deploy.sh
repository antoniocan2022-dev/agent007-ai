#!/usr/bin/env bash
# UPGRADE #211 — Safe deploy script
# Verifies state, deploys, and confirms everything is live.
#
# Usage: VERCEL_TOKEN=xxx bash scripts/safe-deploy.sh
#
# This script:
# 1. Runs session-start verification
# 2. Locks the Vercel project link (prevents "my-project" drift)
# 3. Deploys to Vercel
# 4. Verifies the deploy landed on the correct project
# 5. Tests all key endpoints
# 6. Reports a summary

set -e
cd /home/z/my-project

if [ -z "$VERCEL_TOKEN" ]; then
  echo "❌ VERCEL_TOKEN environment variable required"
  echo "Usage: VERCEL_TOKEN=xxx bash scripts/safe-deploy.sh"
  exit 1
fi

echo "═══════════════════════════════════════════════════════════════"
echo "  SAFE DEPLOY — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Step 1: Verify session state
echo "=== Step 1: Verify session state ==="
bash scripts/verify-session-start.sh 2>&1 | tail -10
echo ""

# Step 2: Lock project link (prevents "my-project" drift)
echo "=== Step 2: Lock Vercel project link ==="
mkdir -p .vercel
cat > .vercel/project.json << 'EOF'
{"projectId":"prj_L1j6UY2GvPq5cfAKQVyvqHxthGK6","orgId":"team_H9ejdX2Laklv1oTBsaCOuCYi","projectName":"agent007-ai"}
EOF
echo "✓ Project locked to agent007-ai"
echo ""

# Step 3: Deploy
echo "=== Step 3: Deploy to Vercel ==="
DEPLOY_OUTPUT=$(VERCEL_TOKEN="$VERCEL_TOKEN" vercel --prod --yes --token "$VERCEL_TOKEN" --scope antoniocan2022-devs-projects 2>&1)
echo "$DEPLOY_OUTPUT" | tail -10
echo ""

# Step 4: Wait for build
echo "=== Step 4: Waiting for build (90s) ==="
sleep 90
echo ""

# Step 5: Verify deploy
echo "=== Step 5: Verify deploy ==="
VERSION=$(curl -s -m 10 https://agent007-ai.vercel.app/api/health 2>&1 | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('version','unknown'))" 2>/dev/null || echo "unknown")
echo "  Live version: $VERSION"

# Step 6: Test key endpoints
echo ""
echo "=== Step 6: Test endpoints ==="
endpoints=(
  "/api/health"
  "/api/tools/test"
  "/api/subagents"
  "/api/system/team-performance"
  "/api/system/capability-audit"
  "/api/system/diagnose-llm"
  "/api/system/morning-brief"
  "/api/system/debate?topic=test&leaders=quantum,echo"
  "/api/system/mission?request=test"
)

PASS=0
FAIL=0
for ep in "${endpoints[@]}"; do
  HTTP=$(curl -s -m 15 -o /dev/null -w "%{http_code}" "https://agent007-ai.vercel.app$ep" 2>/dev/null)
  if [ "$HTTP" = "200" ]; then
    echo "  ✅ $ep — HTTP 200"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $ep — HTTP $HTTP"
    FAIL=$((FAIL + 1))
  fi
done

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  DEPLOY COMPLETE — $PASS passed, $FAIL failed"
echo "  Version: $VERSION"
echo "═══════════════════════════════════════════════════════════════"
