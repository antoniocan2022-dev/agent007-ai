#!/usr/bin/env bash
set -euo pipefail

echo "=== Vercel Build — controlled Postgres release ==="
echo "Working directory: $(pwd)"
echo "DATABASE_URL configured: $([[ -n "${DATABASE_URL:-}" ]] && echo yes || echo no)"

# Step 1: Generate Prisma client from the canonical schema.
echo "=== Step 1: prisma generate ==="
bunx prisma generate

# Step 2: Tell the canonical package build script whether this is a
# PostgreSQL release. The package build owns the actual reconciliation so
# there is exactly one release-time schema reconciliation path.
if [[ "${DATABASE_URL:-}" == postgres://* ]] || [[ "${DATABASE_URL:-}" == postgresql://* ]]; then
  echo "=== Step 2: enable release-time additive schema reconciliation ==="
  export AGENT007_RELEASE_SCHEMA_RECONCILE=1

  # Owner bootstrap is intentionally limited to the controlled release build.
  # Runtime request handlers never reset or create credentials.
  if [[ -n "${OWNER_BOOTSTRAP_PASSWORD:-}" ]]; then
    echo "=== Step 2b: owner credential bootstrap ==="
    bun run db:bootstrap
  else
    echo "=== Step 2b: owner credential bootstrap skipped ==="
  fi
else
  echo "=== Step 2: WARNING — DATABASE_URL is not a PostgreSQL URL ==="
  echo "Skipping database reconciliation during this build."
  unset AGENT007_RELEASE_SCHEMA_RECONCILE
fi

# Step 3: The package build script is the single canonical build entry point.
# It performs release-time reconciliation when explicitly enabled, then runs
# Next.js production build and standalone artifact preparation.
echo "=== Step 3: canonical package build ==="
bun run build
echo "=== Build complete ==="
