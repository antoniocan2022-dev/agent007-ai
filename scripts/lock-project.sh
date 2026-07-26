#!/bin/bash
# ════════════════════════════════════════════════════════════════════
# UPGRADE #154 — Permanent project link lock for agent007-ai
# ════════════════════════════════════════════════════════════════════
# This script ensures .vercel/project.json ALWAYS points to agent007-ai.
# It runs BEFORE every `vercel` command to prevent the CLI from
# auto-creating a new "my-project" project.
#
# Usage: source scripts/lock-project.sh && npx vercel --prod
# Or:    bash scripts/lock-project.sh && npx vercel --prod
# ════════════════════════════════════════════════════════════════════

PROJECT_FILE=".vercel/project.json"
CORRECT_PROJECT_ID="prj_L1j6UY2GvPq5cfAKQVyvqHxthGK6"
CORRECT_ORG_ID="team_H9ejdX2Laklv1oTBsaCOuCYi"
CORRECT_PROJECT_NAME="agent007-ai"

# Check if the project file exists and is correct
if [ -f "$PROJECT_FILE" ]; then
  CURRENT_ID=$(python3 -c "import json; print(json.load(open('$PROJECT_FILE')).get('projectId',''))" 2>/dev/null || echo "")
  
  if [ "$CURRENT_ID" != "$CORRECT_PROJECT_ID" ]; then
    echo "⚠️  Project link is WRONG (pointing to $CURRENT_ID)"
    echo "   Fixing: resetting to agent007-ai ($CORRECT_PROJECT_ID)"
    
    # Ensure .vercel directory exists
    mkdir -p .vercel
    
    # Write the correct project link
    cat > "$PROJECT_FILE" << EOF
{"projectId":"$CORRECT_PROJECT_ID","orgId":"$CORRECT_ORG_ID","projectName":"$CORRECT_PROJECT_NAME"}
EOF
    
    echo "✅ Project link reset to agent007-ai"
  else
    echo "✅ Project link is correct (agent007-ai)"
  fi
else
  echo "⚠️  Project file missing — creating it"
  mkdir -p .vercel
  cat > "$PROJECT_FILE" << EOF
{"projectId":"$CORRECT_PROJECT_ID","orgId":"$CORRECT_ORG_ID","projectName":"$CORRECT_PROJECT_NAME"}
EOF
  echo "✅ Project link created (agent007-ai)"
fi

# Export a shell function that wraps `vercel` to always check the link first
vercel_safe() {
  # Re-check the link before every vercel command
  if [ -f "$PROJECT_FILE" ]; then
    CURRENT_ID=$(python3 -c "import json; print(json.load(open('$PROJECT_FILE')).get('projectId',''))" 2>/dev/null || echo "")
    if [ "$CURRENT_ID" != "$CORRECT_PROJECT_ID" ]; then
      echo "⚠️  Project link drifted — resetting to agent007-ai"
      cat > "$PROJECT_FILE" << EOF
{"projectId":"$CORRECT_PROJECT_ID","orgId":"$CORRECT_ORG_ID","projectName":"$CORRECT_PROJECT_NAME"}
EOF
    fi
  fi
  command npx vercel "$@"
}

# If sourced, export the function. If executed directly, just check.
if [[ "${BASH_SOURCE[0]}" != "${0}" ]]; then
  export -f vercel_safe
  alias vercel='vercel_safe'
  echo "✅ 'vercel' command wrapped — project link will be verified before every deploy"
else
  echo ""
  echo "To use: source scripts/lock-project.sh"
  echo "Then use 'vercel' normally — it will auto-check the project link."
fi
