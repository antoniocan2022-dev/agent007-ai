from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

safe_commit = r'''#!/usr/bin/env bash
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
MESSAGE="${1:-}"
if [ -z "$MESSAGE" ]; then
  echo "Usage: bash scripts/safe-commit.sh \"commit message\"" >&2
  exit 1
fi

echo "=== SAFE COMMIT + PUSH ==="
git add -A
if git diff --cached --quiet; then
  echo "No changes to commit."
  exit 0
fi
git commit -m "$MESSAGE"
CURRENT_BRANCH="$(git branch --show-current)"
if [ -z "$CURRENT_BRANCH" ]; then
  echo "Detached HEAD; refusing to guess a remote target." >&2
  exit 1
fi
git push --set-upstream origin "$CURRENT_BRANCH"
LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git ls-remote origin "refs/heads/${CURRENT_BRANCH}" | awk '{print $1}')"
if [ "$LOCAL" != "$REMOTE" ]; then
  echo "Push verification failed: local=$LOCAL remote=$REMOTE" >&2
  exit 1
fi
echo "Push verified: $LOCAL"
'''
(ROOT / 'scripts/safe-commit.sh').write_text(safe_commit, encoding='utf-8')

session = r'''#!/usr/bin/env bash
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

echo "=== SESSION START VERIFICATION ==="

if [ ! -d ".git" ]; then
  echo "❌ .git directory missing; restore the repository using the normal authenticated Git workflow." >&2
  exit 1
fi

# Authentication is intentionally delegated to the environment/credential helper.
# This script never stores, prompts for, or embeds tokens.
if command -v gh >/dev/null 2>&1; then
  gh auth status >/dev/null 2>&1 || echo "⚠️ gh is installed but not authenticated; authenticated Git operations may fail."
fi
if command -v vercel >/dev/null 2>&1; then
  echo "✅ Vercel CLI available (deployment remains owner-authorized/manual only)."
fi

git fetch origin main >/dev/null 2>&1 || echo "⚠️ Unable to refresh remote main; continuing with local verification."
LOCAL="$(git rev-parse HEAD 2>/dev/null || echo none)"
REMOTE="$(git ls-remote origin main 2>/dev/null | awk '{print $1}' || echo none)"
echo "Local commit:  ${LOCAL:0:8}"
echo "Remote main:   ${REMOTE:0:8}"

KEY_FILES=(
  "src/lib/agent.ts"
  "src/lib/orchestrator.ts"
  "src/lib/subagents.ts"
  "src/lib/tools.ts"
  "src/lib/autonomous-strategic-planner.ts"
  "src/lib/leader-debate.ts"
  "src/lib/mission-os.ts"
  "src/lib/provider-runtime-v2.ts"
  "src/lib/canonical-organizational-state.ts"
  "src/app/api/health/route.ts"
  "src/app/api/system/canonical-state/route.ts"
  "src/app/api/system/evolution/route.ts"
  "vercel.json"
  "scripts/safe-commit.sh"
)
MISSING=0
for f in "${KEY_FILES[@]}"; do
  if [ -f "$f" ]; then echo "✅ $f"; else echo "❌ $f"; MISSING=$((MISSING+1)); fi
done

DELETED_FILES=(
  "src/lib/safety-reliability.ts"
  "src/lib/improvement-actions.ts"
  "src/lib/advanced-tools.ts"
  "src/lib/intelligence-tools.ts"
  "src/app/login/page.tsx.bak"
  "prisma/schema.prisma.bak"
)
for f in "${DELETED_FILES[@]}"; do
  if [ -f "$f" ]; then echo "❌ $f resurrected"; MISSING=$((MISSING+1)); else echo "✅ $f absent"; fi
done

if grep -RInE --exclude-dir=.git --exclude='*.md' --exclude='*.lock' '(ghp_|github_pat_|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|sk-[A-Za-z0-9_-]{20,})' . >/tmp/agent007-secret-scan.txt 2>/dev/null; then
  echo "❌ Potential credential material detected in source tree:" >&2
  cat /tmp/agent007-secret-scan.txt >&2
  exit 1
fi

if [ "$MISSING" -ne 0 ]; then
  echo "❌ Session verification failed ($MISSING issues)." >&2
  exit 1
fi

echo "✅ Session verification passed"
'''
(ROOT / 'scripts/verify-session-start.sh').write_text(session, encoding='utf-8')

print('security pass applied')
