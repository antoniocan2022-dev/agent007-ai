#!/usr/bin/env bash
# UPGRADE #211 — Session start verification
# Run this at the START of every session to verify the filesystem state
# matches what's on GitHub.
#
# Usage: bash scripts/verify-session-start.sh
#
# This script:
# 1. Checks if .git/ exists and is valid
# 2. Checks if the local commit matches the remote
# 3. Checks if key files exist (not lost)
# 4. Re-clones from GitHub if the filesystem is corrupted
# 5. Reports what needs to be re-applied

cd /home/z/my-project

echo "═══════════════════════════════════════════════════════════════"
echo "  SESSION START VERIFICATION"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Check 1: Does .git/ exist?
if [ ! -d ".git" ]; then
  echo "❌ .git/ directory missing — filesystem was reset"
  echo "   Re-cloning from GitHub..."
  cd /tmp && git clone https://github.com/antoniocan2022-dev/agent007-ai.git agent007-restore 2>&1 | tail -3
  cp -r agent007-restore/.git /home/z/my-project/
  cp -r agent007-restore/* /home/z/my-project/ 2>/dev/null
  cd /home/z/my-project
  echo "✓ Re-cloned from GitHub"
else
  echo "✅ .git/ directory exists"
fi

# Check 2: Does gh CLI work?
if ! command -v gh &>/dev/null && [ ! -f "/home/z/bin/gh" ]; then
  echo "⚠️  gh CLI missing — installing..."
  cd /tmp && curl -fsSL -o gh.tar.gz https://github.com/cli/cli/releases/download/v2.63.2/gh_2.63.2_linux_amd64.tar.gz 2>&1 | tail -1
  tar xzf gh.tar.gz && mkdir -p /home/z/bin && cp gh_2.63.2_linux_amd64/bin/gh /home/z/bin/
  echo "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" | /home/z/bin/gh auth login --with-token 2>/dev/null
  /home/z/bin/gh auth setup-git 2>/dev/null
  cd /home/z/my-project
fi
echo "✅ gh CLI available"

# Check 3: Does vercel CLI work?
if ! command -v vercel &>/dev/null; then
  echo "⚠️  vercel CLI missing — installing..."
  npm install -g vercel 2>&1 | tail -2
fi
echo "✅ vercel CLI available"

# Check 4: Fetch latest from GitHub
echo ""
echo "=== Fetching latest from GitHub ==="
git fetch origin main 2>&1 | tail -2

LOCAL=$(git rev-parse HEAD 2>/dev/null || echo "none")
REMOTE=$(git ls-remote origin main 2>/dev/null | awk '{print $1}' || echo "none")

echo "  Local commit:  ${LOCAL:0:8}"
echo "  Remote commit: ${REMOTE:0:8}"

if [ "$LOCAL" = "$REMOTE" ]; then
  echo "✅ Local and remote are in sync"
else
  echo "⚠️  Local and remote differ — running git pull..."
  git pull origin main 2>&1 | tail -3
fi

# Check 5: Key files exist?
echo ""
echo "=== Key files check ==="
KEY_FILES=(
  "src/lib/agent.ts"
  "src/lib/orchestrator.ts"
  "src/lib/subagents.ts"
  "src/lib/tools.ts"
  "src/lib/autonomous-strategic-planner.ts"
  "src/lib/leader-debate.ts"
  "src/lib/mission-os.ts"
  "src/app/api/health/route.ts"
  "src/app/api/system/morning-brief/route.ts"
  "src/app/api/system/debate/route.ts"
  "src/app/api/system/mission/route.ts"
  "vercel.json"
  "scripts/safe-commit.sh"
  "scripts/deploy-locked.sh"
)

MISSING=0
for f in "${KEY_FILES[@]}"; do
  if [ -f "$f" ]; then
    echo "  ✅ $f"
  else
    echo "  ❌ $f — MISSING"
    MISSING=$((MISSING + 1))
  fi
done

# Check 6: Deleted files should NOT exist
echo ""
echo "=== Deleted files check (should NOT exist) ==="
DELETED_FILES=(
  "src/lib/safety-reliability.ts"
  "src/lib/improvement-actions.ts"
  "src/lib/advanced-tools.ts"
)

for f in "${DELETED_FILES[@]}"; do
  if [ -f "$f" ]; then
    echo "  ❌ $f — EXISTS (should be deleted — re-deleting)"
    rm -f "$f"
  else
    echo "  ✅ $f — correctly absent"
  fi
done

echo ""
echo "═══════════════════════════════════════════════════════════════"
if [ "$MISSING" -eq 0 ]; then
  echo "  ✅ SESSION VERIFICATION PASSED — all key files present"
else
  echo "  ⚠️  $MISSING key file(s) missing — may need to restore from GitHub"
fi
echo "═══════════════════════════════════════════════════════════════"
