#!/usr/bin/env bash
set -e

# Vercel invokes this script from the project root. Never depend on a
# developer-specific absolute filesystem path.
echo "=== Vercel Build — Postgres ==="
echo "Working directory: $(pwd)"
echo "DATABASE_URL configured: $([[ -n \"${DATABASE_URL:-}\" ]] && echo yes || echo no)"

# Step 1: Generate the Prisma client from the canonical PostgreSQL schema.
echo "=== Step 1: prisma generate ==="
bunx prisma generate

# Step 2: Reconcile schema only during the controlled release build.
# Runtime request handlers do not create tables or seed production data.
if [[ "${DATABASE_URL:-}" == postgres://* ]] || [[ "${DATABASE_URL:-}" == postgresql://* ]]; then
  echo "=== Step 2: Postgres detected — prisma db push ==="
  bunx prisma db push --accept-data-loss 2>&1 | tail -15

  # Controlled owner bootstrap: only a release build with an explicitly
  # configured OWNER_BOOTSTRAP_PASSWORD may reconcile the owner credential.
  # This never runs during normal request handling and never exposes the secret.
  if [[ -n "${OWNER_BOOTSTRAP_PASSWORD:-}" ]]; then
    echo "=== Step 2b: Owner credential bootstrap ==="
    bun run db:bootstrap
  else
    echo "=== Step 2b: Owner credential bootstrap skipped (secret not configured) ==="
  fi
else
  echo "=== Step 2: WARNING — DATABASE_URL is not a PostgreSQL URL ==="
  echo "Skipping database reconciliation during this build."
fi

# Step 3: Build the application.
echo "=== Step 3: next build ==="
bun run build
echo "=== Build complete ==="
