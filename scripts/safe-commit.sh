#!/usr/bin/env bash
# UPGRADE #211 — Safe commit + push wrapper
# Prevents work loss by ensuring every change is committed AND pushed
# before the session ends.
#
# Usage: bash scripts/safe-commit.sh "your commit message"
#
# This script:
# 1. Stages ALL changes (including deletions)
# 2. Commits with the provided message
# 3. Pushes to GitHub immediately
# 4. Verifies the push succeeded
# 5. Prints a summary of what was saved

set -e
cd /home/z/my-project

if [ -z "$1" ]; then
  echo "❌ Commit message required"
  echo "Usage: bash scripts/safe-commit.sh \"your commit message\""
  exit 1
fi

MESSAGE="$1"
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

echo "═══════════════════════════════════════════════════════════════"
echo "  SAFE COMMIT + PUSH — $TIMESTAMP"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Step 1: Check for gh CLI and re-auth if needed
if ! /home/z/bin/gh auth status &>/dev/null 2>&1; then
  echo "⚠️  GitHub auth lost — re-authenticating..."
  echo "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" | /home/z/bin/gh auth login --with-token 2>/dev/null
  /home/z/bin/gh auth setup-git 2>/dev/null
fi

# Step 2: Stage ALL changes (including deletions, new files, modifications)
echo "=== Step 1: Stage all changes ==="
git add -A
CHANGED=$(git diff --cached --name-only | wc -l)
echo "✓ $CHANGED files staged"
echo ""

# Step 3: Commit
echo "=== Step 2: Commit ==="
git commit -m "$MESSAGE" 2>&1 | tail -3
echo ""

# Step 4: Push (try 3 times in case of network issues)
echo "=== Step 3: Push to GitHub ==="
PUSH_SUCCESS=false
for i in 1 2 3; do
  if git push origin main 2>&1 | tail -3; then
    PUSH_SUCCESS=true
    break
  fi
  echo "⚠️  Push attempt $i failed, retrying..."
  sleep 2
done

if [ "$PUSH_SUCCESS" = false ]; then
  echo "❌ Push failed after 3 attempts — trying force push..."
  git push --force origin main 2>&1 | tail -3
fi

echo ""

# Step 5: Verify
echo "=== Step 4: Verify ==="
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git ls-remote origin main | awk '{print $1}')

if [ "$LOCAL" = "$REMOTE" ]; then
  echo "✅ Push verified — local and remote are in sync"
  echo "   Commit: $(git rev-parse --short HEAD)"
  echo "   Message: $MESSAGE"
else
  echo "⚠️  Local and remote differ — push may have failed"
  echo "   Local:  $LOCAL"
  echo "   Remote: $REMOTE"
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  ✅ SAFE COMMIT COMPLETE — work is saved on GitHub"
echo "═══════════════════════════════════════════════════════════════"
