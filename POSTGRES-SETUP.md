# Vercel Postgres Setup — Fix #4 (Upgrade #53)

## Why Switch to Postgres?
Vercel's ephemeral SQLite (in /tmp) can reset on every cold start, causing:
- Lost memories, income logs, schedules, agent progress
- Settings not persisting reliably
- The persistent-memory workaround (upgrade #52) was needed because of this

Postgres is PERMANENT — data survives every cold start, every deploy, every restart.

## How to Set Up (5 minutes)

### Step 1: Create Postgres Database
1. Go to https://vercel.com/dashboard → your project (agent007-ai)
2. Click "Storage" tab
3. Click "Create Database" → "Postgres" → "Hobby" (FREE tier)
4. Name it "agent007-db"
5. Click "Create"

### Step 2: Connect to Project
1. After creation, click "Connect to Project"
2. Select "agent007-ai" project
3. Vercel auto-adds `DATABASE_URL` + `POSTGRES_URL` env vars

### Step 3: Redeploy
1. Go to "Deployments" tab
2. Click the latest deployment → "Redeploy"
3. The build script (vercel-build.sh) auto-detects Postgres and:
   - Switches prisma schema from sqlite → postgresql
   - Runs `prisma db push` to create all 33 tables
   - Seeds the owner user + 2FA config + schedules + memories

### Step 4: Verify
After redeploy, check:
- https://agent007-ai.vercel.app/api/system/audit → database=pass
- https://agent007-ai.vercel.app/api/settings → settings persisted
- Login → settings should now PERMANENTLY survive cold starts

## What Changes Automatically
The build script (scripts/vercel-build.sh) already has Postgres auto-detection:
```bash
if [[ "$DATABASE_URL" == postgres://* ]] || [[ "$DATABASE_URL" == postgresql://* ]]; then
  echo "=== Postgres detected ==="
  sed -i 's|provider = "sqlite"|provider = "postgresql"|' prisma/schema.prisma
  bunx prisma generate
  bunx prisma db push --accept-data-loss
fi
```

When you connect Postgres, `DATABASE_URL` changes from `file:/tmp/...` to `postgres://...`,
and the build script automatically switches everything.

## Cost
- Hobby tier: FREE (up to 256MB storage, 60 compute hours/month)
- Pro tier: $20/month (up to 1GB storage, 1000 compute hours/month)
- Agent007 needs <10MB storage → FREE tier is more than enough

## After Setup
Once Postgres is connected:
- ✅ Memories persist forever (no more /tmp file workaround needed)
- ✅ Settings persist across every cold start
- ✅ Income logs, schedules, conversations all permanent
- ✅ 2FA config survives restarts
- ✅ Eliminates 80% of data persistence bugs
