#!/usr/bin/env bash
set -e
cd /home/z/my-project
echo "=== Vercel Build ==="
echo "DATABASE_URL: ${DATABASE_URL:-(not set)}"

# Step 1: Prisma generate (always needed)
echo "=== Step 1: prisma generate ==="
bunx prisma generate

# Step 2: If Postgres, swap schema + push. If not, just use SQLite.
if [[ "$DATABASE_URL" == postgres://* ]] || [[ "$DATABASE_URL" == postgresql://* ]]; then
  echo "=== Postgres detected ==="
  sed -i 's|provider = "sqlite"|provider = "postgresql"|' prisma/schema.prisma
  bunx prisma generate
  bunx prisma db push --accept-data-loss 2>&1 | tail -10 || true
else
  echo "=== SQLite mode ==="
  export DATABASE_URL="file:/tmp/agent007-prod.db"
  bunx prisma db push 2>&1 | tail -5 || true
fi

# Step 3: Build
echo "=== Step 2: next build ==="
bun run build
echo "=== Build complete ==="
