#!/usr/bin/env bash
set -e
cd /home/z/my-project
echo "=== Vercel Build (Upgrade #60 — Postgres) ==="
echo "DATABASE_URL: ${DATABASE_URL:0:30}..."

# Step 1: Prisma generate (schema is now provider = "postgresql" — no more swap)
echo "=== Step 1: prisma generate ==="
bunx prisma generate

# Step 2: If Postgres URL is set, push schema to create/update tables
if [[ "$DATABASE_URL" == postgres://* ]] || [[ "$DATABASE_URL" == postgresql://* ]]; then
  echo "=== Postgres detected — running prisma db push ==="
  bunx prisma db push --accept-data-loss 2>&1 | tail -15 || echo "prisma db push failed (continuing — tables will be created via raw SQL at runtime)"
else
  echo "=== WARNING: DATABASE_URL is not set to Postgres ==="
  echo "DATABASE_URL = ${DATABASE_URL:-(not set)}"
  echo "Schema is provider = postgresql, so Prisma will fail at runtime."
  echo "Set DATABASE_URL to a Postgres connection string on Vercel."
  # Continue with build anyway — the app will boot but DB queries will fail
fi

# Step 3: Build
echo "=== Step 3: next build ==="
bun run build
echo "=== Build complete ==="
