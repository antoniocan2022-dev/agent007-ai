#!/usr/bin/env bash
set -e
cd /home/z/my-project
echo "=== Vercel Build ==="
echo "DATABASE_URL prefix: $(echo "$DATABASE_URL" | sed 's/:.*$//')"
bunx prisma generate
if [[ "$DATABASE_URL" == postgres://* ]] || [[ "$DATABASE_URL" == postgresql://* ]]; then
  echo "=== Postgres detected ==="
  sed -i 's|provider = "sqlite"|provider = "postgresql"|' prisma/schema.prisma
  bunx prisma db push --accept-data-loss 2>&1 | tail -10 || true
else
  echo "=== SQLite fallback ==="
  export DATABASE_URL="file:/tmp/agent007-prod.db"
  bunx prisma db push 2>&1 | tail -5
fi
echo "=== next build ==="
bun run build
echo "=== Build complete ==="
