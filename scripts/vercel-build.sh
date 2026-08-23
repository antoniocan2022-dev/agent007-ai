#!/usr/bin/env bash
set -euo pipefail

echo "=== Vercel Build — controlled Postgres release ==="
echo "Working directory: $(pwd)"
echo "DATABASE_URL configured: $([[ -n "${DATABASE_URL:-}" ]] && echo yes || echo no)"

# Step 1: Generate Prisma client from the canonical schema.
echo "=== Step 1: prisma generate ==="
bunx prisma generate

# Step 2: Tell the canonical package build script whether this is a
# PostgreSQL release. The package build owns the actual schema reconciliation,
# so there is exactly one release-time reconciliation path.
if [[ "${DATABASE_URL:-}" == postgres://* ]] || [[ "${DATABASE_URL:-}" == postgresql://* ]]; then
  echo "=== Step 2: enable release-time additive schema reconciliation ==="
  export AGENT007_RELEASE_SCHEMA_RECONCILE=1
else
  echo "=== Step 2: WARNING — DATABASE_URL is not a PostgreSQL URL ==="
  echo "Skipping database reconciliation during this build."
  unset AGENT007_RELEASE_SCHEMA_RECONCILE
fi

# Step 3: The canonical package build performs schema reconciliation first,
# then builds the application. This guarantees the schema exists before any
# controlled owner bootstrap touches release-time database state.
echo "=== Step 3: canonical package build ==="
bun run build

# Step 4: Owner bootstrap happens only after the schema reconciliation/build
# succeeds. A failure prevents the Vercel build from completing, so a release
# can never be published with an incomplete controlled owner bootstrap.
if [[ "${DATABASE_URL:-}" == postgres://* ]] || [[ "${DATABASE_URL:-}" == postgresql://* ]]; then
  if [[ -n "${OWNER_BOOTSTRAP_PASSWORD:-}" ]]; then
    echo "=== Step 4: owner credential bootstrap ==="
    bun run db:bootstrap
  else
    echo "=== Step 4: owner credential bootstrap skipped ==="
  fi
fi

echo "=== Build complete ==="
