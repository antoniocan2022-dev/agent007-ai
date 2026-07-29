#!/bin/bash
# Post-deploy verification — ensures we deployed to agent007-ai, not my-project
# Run AFTER every `npx vercel --prod` to catch auto-creation immediately.

TOKEN="${VERCEL_TOKEN:-}"
if [ -z "$TOKEN" ]; then
  echo "⚠️  VERCEL_TOKEN env var not set — cannot verify"
  exit 0
fi

PROJECT_FILE=".vercel/project.json"
EXPECTED_PROJECT_ID="prj_L1j6UY2GvPq5cfAKQVyvqHxthGK6"

CURRENT_ID=$(python3 -c "import json; print(json.load(open('$PROJECT_FILE')).get('projectId',''))" 2>/dev/null || echo "")

if [ "$CURRENT_ID" != "$EXPECTED_PROJECT_ID" ]; then
  echo "❌ PROJECT LINK DRIFTED to $CURRENT_ID (expected $EXPECTED_PROJECT_ID)"
  echo "   Run: bash scripts/lock-project.sh"
  exit 1
fi

# Also check the user's live site
ACTUAL=$(curl -s https://agent007-ai.vercel.app/api/system/diagnose-llm 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('testResult',{}).get('provider','?'))" 2>/dev/null || echo "?")
echo "Live diagnose provider: $ACTUAL (expect 'groq' if fix #168 is live)"

if [ "$ACTUAL" = "groq" ]; then
  echo "✅ Fix #168 is LIVE on production"
elif [ "$ACTUAL" = "openai-fallback" ]; then
  echo "❌ Fix #168 is NOT live — production still using OpenAI first"
  exit 1
fi

echo "✅ Project link verified — agent007-ai"
