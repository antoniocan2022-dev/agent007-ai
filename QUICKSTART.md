# 🚀 Agent007 AI — Quick Start

## Step 1 — Unzip
```bash
unzip agent007-ai.zip -d agent007-ai
cd agent007-ai
```

## Step 2 — Install Bun (if needed)
```bash
curl -fsSL https://bun.sh/install | bash
```

## Step 3 — Install dependencies
```bash
bun install
```

## Step 4 — Configure environment
```bash
cp .env.example .env
# Edit .env — set NEXTAUTH_SECRET (run: openssl rand -base64 32)
```

## Step 5 — Set up database
```bash
bunx prisma generate
bunx prisma db push
```

## Step 6 — Run locally (optional)
```bash
bun run dev
# Open http://localhost:3000
# Sign in: antonio.can2022@hotmail.com / antonio.can2022@hotmail.com
```

## Step 7 — Deploy to Vercel
```bash
bash scripts/deploy-vercel.sh
```

## After deployment
1. Visit your live URL → sign in
2. Settings → API Keys → add OPENAI_API_KEY
3. Settings → WhatsApp Connect → Baileys → Generate QR → scan with phone
4. Settings → Profile → Change Password
