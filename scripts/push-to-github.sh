#!/usr/bin/env bash
# push-to-github.sh — Create a GitHub repo + push Agent007 to it
#
# This script:
# 1. Checks for GitHub CLI (gh) — installs if missing
# 2. Authenticates with GitHub (interactive browser flow OR token)
# 3. Creates a new private repo named "agent007-ai" (or name you choose)
# 4. Pushes all code + commit history
# 5. Returns the repo URL
#
# Prerequisites:
#   - GitHub account (free is fine)
#   - Either run `gh auth login` first, OR set GH_TOKEN env var
#
# Usage:
#   bash scripts/push-to-github.sh [repo-name] [public|private]
#
# Examples:
#   bash scripts/push-to-github.sh                          # agent007-ai, private
#   bash scripts/push-to-github.sh agent007-ai public       # public repo
#   bash scripts/push-to-github.sh my-agent007 private      # custom name, private

set -e

cd /home/z/my-project

REPO_NAME="${1:-agent007-ai}"
VISIBILITY="${2:-private}"  # private or public

echo "═══════════════════════════════════════════════════════════════"
echo "  Agent007 AI — GitHub Repo Creation + Push"
echo "═══════════════════════════════════════════════════════════════"
echo "  Repo name: $REPO_NAME"
echo "  Visibility: $VISIBILITY"
echo ""

# Step 1: Check for GitHub CLI
echo "=== Step 1: Check GitHub CLI ==="
if ! command -v gh &> /dev/null; then
  echo "❌ GitHub CLI not installed. Installing..."
  if command -v brew &> /dev/null; then
    brew install gh
  elif command -v apt &> /dev/null; then
    sudo apt update && sudo apt install gh -y
  elif command -v dnf &> /dev/null; then
    sudo dnf install gh -y
  else
    # User-space install
    mkdir -p ~/.local/bin
    GH_VERSION="2.65.0"
    ARCH=$(uname -m)
    if [ "$ARCH" = "x86_64" ] || [ "$ARCH" = "amd64" ]; then GH_ARCH="linux_amd64"
    elif [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then GH_ARCH="linux_arm64"
    elif [ "$ARCH" = "Darwin" ]; then GH_ARCH="macOS_amd64"
    fi
    curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_${GH_ARCH}.tar.gz" -o /tmp/gh.tar.gz
    tar xzf /tmp/gh.tar.gz -C /tmp
    cp /tmp/gh_${GH_VERSION}_${GH_ARCH}/bin/gh ~/.local/bin/gh
    chmod +x ~/.local/bin/gh
    export PATH=$HOME/.local/bin:$PATH
    echo 'export PATH=$HOME/.local/bin:$PATH' >> ~/.bashrc
  fi
fi
echo "✅ GitHub CLI: $(gh --version | head -1)"

# Step 2: Authenticate
echo ""
echo "=== Step 2: Authenticate with GitHub ==="
if ! gh auth status &> /dev/null; then
  if [ -n "$GH_TOKEN" ] || [ -n "$GITHUB_TOKEN" ]; then
    echo "Using GH_TOKEN from environment..."
    echo "${GH_TOKEN:-$GITHUB_TOKEN}" | gh auth login --with-token
  else
    echo "Opening browser for GitHub authentication..."
    echo "Click 'Authorize github' when prompted."
    gh auth login --web --git-protocol https
  fi
fi
echo "✅ Authenticated as: $(gh auth status 2>&1 | grep 'Logged in' | head -1)"

# Step 3: Configure git identity if not set
echo ""
echo "=== Step 3: Configure git identity ==="
git config user.email "${GIT_EMAIL:-antonio.can2022@hotmail.com}"
git config user.name "${GIT_NAME:-Antonio (Agent007)}"
git config init.defaultBranch main
echo "✅ Git identity: $(git config user.name) <$(git config user.email)>"

# Step 4: Create the repo
echo ""
echo "=== Step 4: Create GitHub repo '$REPO_NAME' ($VISIBILITY) ==="
if gh repo view "$REPO_NAME" &> /dev/null; then
  echo "ℹ Repo '$REPO_NAME' already exists — will push to it"
else
  if [ "$VISIBILITY" = "public" ]; then
    gh repo create "$REPO_NAME" --public --description "Agent007 AI — Autonomous AI super-agent with 309 tools, 18 sub-agents, full self-repair + autonomous issue resolution. Built with Next.js 16, Prisma, NextAuth, z-ai-web-dev-sdk."
  else
    gh repo create "$REPO_NAME" --private --description "Agent007 AI — Autonomous AI super-agent with 309 tools, 18 sub-agents, full self-repair + autonomous issue resolution. Built with Next.js 16, Prisma, NextAuth, z-ai-web-dev-sdk."
  fi
  echo "✅ Repo created: $REPO_NAME"
fi

# Step 5: Add remote + push
echo ""
echo "=== Step 5: Add remote + push ==="
REPO_URL=$(gh repo view "$REPO_NAME" --json url -q .url)
echo "Repo URL: $REPO_URL"

# Remove existing remote if present
git remote remove origin 2>/dev/null || true
git remote add origin "$REPO_URL"
echo "✅ Remote 'origin' added"

# Step 6: Push everything
echo ""
echo "=== Step 6: Push to GitHub ==="
echo "Pushing main branch (this may take a minute for large repos)..."
git push -u origin main --force 2>&1 | tail -10

# Step 7: Verify
echo ""
echo "=== Step 7: Verify push ==="
sleep 3
if git ls-remote --heads origin main &> /dev/null; then
  echo "✅ Push successful — code is live on GitHub"
else
  echo "⚠ Push may have failed — check the output above"
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  🚀 GITHUB REPO CREATED + CODE PUSHED"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "  Repo URL: $REPO_URL"
echo "  Clone:    git clone $REPO_URL"
echo ""
echo "  Next steps:"
echo "    1. Visit $REPO_URL to see your code"
echo "    2. Go to https://vercel.com/new → import the repo"
echo "    3. Vercel auto-detects Next.js → click Deploy"
echo "    4. Add env vars in Vercel dashboard (DATABASE_URL, NEXTAUTH_SECRET, etc.)"
echo "    5. Your live URL will be https://agent007-ai.vercel.app (or similar)"
echo ""
echo "  To push future changes:"
echo "    git add -A && git commit -m 'description' && git push"
echo ""
echo "═══════════════════════════════════════════════════════════════"
