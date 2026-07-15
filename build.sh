#!/bin/bash
set -e

if [[ "$DATABASE_URL" == postgres://* ]] || [[ "$DATABASE_URL" == postgresql://* ]]; then
  echo "=== Postgres detected, switching schema ==="
  sed -i 's|provider = "sqlite"|provider = "postgresql"|' prisma/schema.prisma
  bunx prisma generate
  echo "=== Pushing schema to Postgres ==="
  bunx prisma db push --accept-data-loss 2>&1 || true
else
  echo "=== SQLite mode ==="
  bunx prisma generate
fi

echo "=== Building Next.js ==="
next build
