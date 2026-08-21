#!/usr/bin/env bash
set -euo pipefail

echo "=== Vercel Build — controlled Postgres release ==="
echo "Working directory: $(pwd)"
echo "DATABASE_URL configured: $([[ -n "${DATABASE_URL:-}" ]] && echo yes || echo no)"

# Step 1: Generate Prisma client from the canonical schema.
echo "=== Step 1: prisma generate ==="
bunx prisma generate

# Step 2: Reconcile production schema only through the canonical additive,
# idempotent reconciliation script. Never use prisma db push --accept-data-loss
# in the production release path.
if [[ "${DATABASE_URL:-}" == postgres://* ]] || [[ "${DATABASE_URL:-}" == postgresql://* ]]; then
  echo "=== Step 2: additive production schema reconciliation ==="
  bun run db:reconcile

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
fi

# Step 3: Build the application.
echo "=== Step 3: next build ==="
bun run build
echo "=== Build complete ==="
