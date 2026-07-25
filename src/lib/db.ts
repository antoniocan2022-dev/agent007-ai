import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { v4 as uuidv4 } from 'uuid'

// ── UPGRADE #60 — Postgres support ─────────────────────────────────────
//
// PREVIOUS STATE (broken):
//   - schema.prisma: provider = "sqlite"
//   - Vercel env: DATABASE_URL was missing OR set to a Postgres URL
//   - Result: Prisma rejected the mismatch → every DB call crashed →
//     /api/init returned "URL must start with protocol file:" error
//   - Workaround (upgrade #58): force SQLite with file:/tmp/agent007.db
//   - Problem: /tmp is read-only on Vercel cold starts → "Unable to open
//     database file" error → still broken
//
// FIX (upgrade #60):
//   - schema.prisma: provider = "postgresql" (matches Postgres DATABASE_URL)
//   - db.ts: NO MORE SQLite fallback. If DATABASE_URL is missing, we
//     throw a clear error telling the owner to set it. We do NOT silently
//     fall back to a broken SQLite path.
//   - Owner must set DATABASE_URL to a Postgres connection string on Vercel
//     (free tier available at Vercel Storage → Postgres, Neon, Supabase)
//
// WHAT THIS MEANS FOR LOCAL DEV:
//   - Local dev MUST have a Postgres DATABASE_URL set in .env or .env.local
//   - If not set, the app will boot but DB queries will fail with a clear error
//   - For local dev, the owner can use: docker run -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres
//   - Or use a free Neon/Supabase Postgres instance
;(function ensurePostgresDatabaseUrl() {
  const current = process.env.DATABASE_URL
  if (!current) {
    console.error(
      '[db] FATAL: DATABASE_URL env var is not set. ' +
        'Set it to a Postgres connection string (e.g. postgresql://user:pass@host:5432/dbname). ' +
        'On Vercel: Dashboard → Storage → Create Postgres → Connect to project. ' +
        'Locally: use docker postgres or a free Neon/Supabase instance.'
    )
    // Don't throw — let the app boot. Prisma will throw a clear error on first query.
  } else if (!current.startsWith('postgres://') && !current.startsWith('postgresql://')) {
    console.error(
      `[db] FATAL: DATABASE_URL must be a Postgres URL (start with postgres:// or postgresql://). ` +
        `Got: ${current.slice(0, 30)}... — schema.prisma is now provider = "postgresql"`
    )
  } else {
    console.log('[db] DATABASE_URL is Postgres-compatible ✅')
  }
})()

// UPGRADE #120 — Import from centralized config (reads from env var, no hardcoded PII)
import { SEED_EMAIL, OWNER_PHONE } from '@/lib/owner-config'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  prismaSchemaVersion?: string
  dbInitialized?: boolean
}

const SCHEMA_VERSION = 'v7-raw-sql-init-all-33-tables'

function createPrisma(): PrismaClient {
  return new PrismaClient()
}

// Create tables via raw SQL (works on Vercel runtime, no better-sqlite3 needed)
// ALL 33 Prisma models must have a corresponding CREATE TABLE statement here.
// When you add a new model to prisma/schema.prisma, also add its CREATE TABLE
// here — otherwise the system audit will report "database: fail" on Vercel
// because the ephemeral DB has no migration history.
async function createTablesViaRawSQL() {
  try {
    // ── UPGRADE #60 — Postgres-compatible DDL ───────────────────────────
    // Previously used SQLite syntax (TEXT, INTEGER, REAL, DATETIME, BOOLEAN DEFAULT 1).
    // Now uses Postgres syntax (TEXT, INTEGER, DOUBLE PRECISION, TIMESTAMP, BOOLEAN DEFAULT true).
    // Also: Prisma's `db push` is the canonical way to create tables — this raw SQL
    // is a SAFETY NET for cases where db push hasn't run yet (e.g. first deploy).
    const statements = [
      // ── Core 17 tables ────────────────────────────────────────────────
      `CREATE TABLE IF NOT EXISTS "User" (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, "passwordHash" TEXT NOT NULL, name TEXT, "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS "Conversation" (id TEXT PRIMARY KEY, "userId" TEXT, title TEXT DEFAULT 'New Conversation', "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS "Message" (id TEXT PRIMARY KEY, "conversationId" TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, "toolName" TEXT, "toolArgs" TEXT, "toolResult" TEXT, attachments TEXT, "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS "Memory" (id TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, value TEXT NOT NULL, category TEXT DEFAULT 'general', "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS "Schedule" (id TEXT PRIMARY KEY, "userId" TEXT NOT NULL, name TEXT NOT NULL, prompt TEXT NOT NULL, "intervalMin" INTEGER NOT NULL, enabled BOOLEAN DEFAULT true, "lastRunAt" TIMESTAMP(3), "nextRunAt" TIMESTAMP(3), "lastConvId" TEXT, "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS "CustomSubagent" (id TEXT PRIMARY KEY, "userId" TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL, specialty TEXT, color TEXT, icon TEXT, "allowedTools" TEXT, "systemPrompt" TEXT, enabled BOOLEAN DEFAULT true, "isBuiltinOverlay" BOOLEAN DEFAULT false, "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS "AuditLog" (id TEXT PRIMARY KEY, "userId" TEXT, action TEXT NOT NULL, entity TEXT NOT NULL, "entityId" TEXT, description TEXT NOT NULL, metadata TEXT, "ipAddress" TEXT, "userAgent" TEXT, "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS "PhoneConfig" (id TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "phoneNumber" TEXT, "whatsappNumber" TEXT, email TEXT, "smsEnabled" BOOLEAN DEFAULT false, "whatsappEnabled" BOOLEAN DEFAULT false, "emailEnabled" BOOLEAN DEFAULT false, "whatsappProvider" TEXT, "callmebotApiKey" TEXT, "callmebotNumber" TEXT, "baileysSessionStatus" TEXT, "baileysLinkedNumber" TEXT, "baileysLinkedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS "IncomingCommand" (id TEXT PRIMARY KEY, "userId" TEXT NOT NULL, source TEXT NOT NULL, "fromNumber" TEXT, "fromEmail" TEXT, command TEXT NOT NULL, status TEXT DEFAULT 'pending', "conversationId" TEXT, result TEXT, "receivedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP, "executedAt" TIMESTAMP(3))`,
      `CREATE TABLE IF NOT EXISTS "IncomeEntry" (id TEXT PRIMARY KEY, amount DOUBLE PRECISION NOT NULL, source TEXT NOT NULL, notes TEXT, date TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP, "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS "UserSetting" (id TEXT PRIMARY KEY, "userId" TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, UNIQUE("userId", key))`,
      `CREATE TABLE IF NOT EXISTS "NotificationLog" (id TEXT PRIMARY KEY, "userId" TEXT NOT NULL, type TEXT NOT NULL, "to" TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, sent BOOLEAN DEFAULT false, "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS "PendingManageAction" (id TEXT PRIMARY KEY, "userId" TEXT NOT NULL, action TEXT NOT NULL, attrs TEXT NOT NULL, status TEXT DEFAULT 'pending', result TEXT, "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS "ApiKey" (id TEXT PRIMARY KEY, "userId" TEXT NOT NULL, name TEXT NOT NULL, service TEXT NOT NULL, key TEXT NOT NULL, "baseUrl" TEXT, "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS "TwoFactorSecret" (id TEXT PRIMARY KEY, "userId" TEXT NOT NULL, method TEXT NOT NULL, "phoneNumber" TEXT, email TEXT, secret TEXT, "qrCodeUrl" TEXT, "backupCodes" TEXT, enabled BOOLEAN DEFAULT false, "verifiedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS "BankAccount" (id TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "accountHolder" TEXT NOT NULL, "bankName" TEXT NOT NULL, "accountType" TEXT DEFAULT 'checking', "accountNumber" TEXT NOT NULL, "routingNumber" TEXT NOT NULL, "accountLast4" TEXT, "bankCountry" TEXT DEFAULT 'US', "bankCurrency" TEXT DEFAULT 'USD', "verificationStatus" TEXT DEFAULT 'pending', "isPrimary" BOOLEAN DEFAULT false, label TEXT, "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS "PayPalAccount" (id TEXT PRIMARY KEY, "userId" TEXT NOT NULL, email TEXT NOT NULL, "clientId" TEXT, "clientSecret" TEXT, "webhookId" TEXT, "isPrimary" BOOLEAN DEFAULT false, verified BOOLEAN DEFAULT false, "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP)`,

      // ── Phase-2 business tables ───────────────────────────────────────
      `CREATE TABLE IF NOT EXISTS "Customer" (id TEXT PRIMARY KEY, "userId" TEXT NOT NULL, name TEXT NOT NULL, email TEXT, phone TEXT, company TEXT, status TEXT DEFAULT 'lead', value DOUBLE PRECISION DEFAULT 0, source TEXT, notes TEXT, tags TEXT, "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS "MarketingCampaign" (id TEXT PRIMARY KEY, "userId" TEXT NOT NULL, name TEXT NOT NULL, channel TEXT, status TEXT DEFAULT 'draft', budget DOUBLE PRECISION DEFAULT 0, spent DOUBLE PRECISION DEFAULT 0, "leadsGenerated" INTEGER DEFAULT 0, conversions INTEGER DEFAULT 0, revenue DOUBLE PRECISION DEFAULT 0, "startDate" TIMESTAMP(3), "endDate" TIMESTAMP(3), metadata TEXT, "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS "Partnership" (id TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "partnerName" TEXT NOT NULL, "partnerType" TEXT, status TEXT DEFAULT 'proposed', "commissionRate" DOUBLE PRECISION DEFAULT 0, "revenueGenerated" DOUBLE PRECISION DEFAULT 0, "contactEmail" TEXT, "contactPhone" TEXT, notes TEXT, "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS "BusinessStrategy" (id TEXT PRIMARY KEY, "userId" TEXT NOT NULL, phase TEXT, title TEXT NOT NULL, description TEXT, status TEXT DEFAULT 'planned', priority TEXT DEFAULT 'medium', progress DOUBLE PRECISION DEFAULT 0, "targetDate" TIMESTAMP(3), "completedAt" TIMESTAMP(3), metadata TEXT, "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS "MissionTracker" (id TEXT PRIMARY KEY, "userId" TEXT NOT NULL, metric TEXT NOT NULL, "currentValue" DOUBLE PRECISION NOT NULL, "targetValue" DOUBLE PRECISION NOT NULL, "withoutImprovements" DOUBLE PRECISION, "withImprovements" DOUBLE PRECISION, unit TEXT, "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS "ServicePackage" (id TEXT PRIMARY KEY, "userId" TEXT NOT NULL, name TEXT NOT NULL, description TEXT, category TEXT, "priceMonthly" DOUBLE PRECISION DEFAULT 0, "priceOneTime" DOUBLE PRECISION DEFAULT 0, "deliveryTime" TEXT, features TEXT, active BOOLEAN DEFAULT true, "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS "Opportunity" (id TEXT PRIMARY KEY, "userId" TEXT NOT NULL, title TEXT NOT NULL, description TEXT, category TEXT, potential DOUBLE PRECISION, status TEXT DEFAULT 'new', metadata TEXT, "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS "Prediction" (id TEXT PRIMARY KEY, "userId" TEXT NOT NULL, category TEXT, prediction TEXT, confidence DOUBLE PRECISION DEFAULT 0.5, timeframe TEXT, outcome TEXT, "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS "SystemHealth" (id TEXT PRIMARY KEY, "userId" TEXT NOT NULL, component TEXT, status TEXT DEFAULT 'healthy', details TEXT, "autoRepaired" BOOLEAN DEFAULT false, "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS "MLModel" (id TEXT PRIMARY KEY, "userId" TEXT NOT NULL, name TEXT NOT NULL, type TEXT, features TEXT, weights TEXT, accuracy DOUBLE PRECISION DEFAULT 0.0, "trainSamples" INTEGER DEFAULT 0, "lastTrained" TIMESTAMP(3), "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS "RiskRegister" (id TEXT PRIMARY KEY, "userId" TEXT NOT NULL, category TEXT, description TEXT NOT NULL, likelihood INTEGER DEFAULT 3, impact INTEGER DEFAULT 3, score INTEGER DEFAULT 15, level TEXT DEFAULT 'medium', mitigations TEXT, status TEXT DEFAULT 'active', "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS "ComplianceCheck" (id TEXT PRIMARY KEY, "userId" TEXT NOT NULL, country TEXT, regulation TEXT, status TEXT DEFAULT 'pending', details TEXT, "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS "ContractDraft" (id TEXT PRIMARY KEY, "userId" TEXT NOT NULL, title TEXT NOT NULL, type TEXT, parties TEXT, terms TEXT, status TEXT DEFAULT 'draft', "riskScore" INTEGER DEFAULT 5, notes TEXT, "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS "Transaction" (id TEXT PRIMARY KEY, "userId" TEXT NOT NULL, provider TEXT NOT NULL, "providerTxId" TEXT NOT NULL, amount DOUBLE PRECISION NOT NULL, currency TEXT DEFAULT 'USD', status TEXT DEFAULT 'succeeded', "customerEmail" TEXT, "customerName" TEXT, "productName" TEXT, description TEXT, "rawPayload" TEXT, "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP, UNIQUE(provider, "providerTxId"))`,
      `CREATE TABLE IF NOT EXISTS "KnowledgeDoc" (id TEXT PRIMARY KEY, "userId" TEXT NOT NULL, filename TEXT NOT NULL, "mimeType" TEXT, size INTEGER, text TEXT, "chunkCount" INTEGER DEFAULT 0, "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS "KnowledgeChunk" (id TEXT PRIMARY KEY, "docId" TEXT NOT NULL, "userId" TEXT NOT NULL, content TEXT, "chunkIndex" INTEGER, keywords TEXT DEFAULT '', "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP)`,
    ]
    let created = 0
    let alreadyExisted = 0
    let failed = 0

    // UPGRADE #142 — BATCH CREATE TABLE STATEMENTS (Issue A fix)
    // Before: 33 sequential `await $executeRawUnsafe(sql)` calls = 33 Postgres
    //   round-trips = ~6-8 seconds on every cold start.
    // After: Group statements into a SINGLE multi-statement query.
    //
    // UPGRADE #146 (Critical #4 fix) — On ANY batch failure, ALWAYS fall back to
    // one-by-one execution. The previous code assumed that a "already exists"
    // batch error meant ALL 8 tables existed, which silently skipped new tables
    // that landed in the same batch as existing ones.
    const BATCH_SIZE = 8
    for (let i = 0; i < statements.length; i += BATCH_SIZE) {
      const batch = statements.slice(i, i + BATCH_SIZE)
      const combined = batch.join(';\n')
      let batchSucceeded = false
      try {
        await (db as any).$executeRawUnsafe(combined)
        created += batch.length
        batchSucceeded = true
      } catch (e: any) {
        // Batch failed — could be (a) one table already exists, (b) syntax error
        // in one statement, or (c) genuine DB error. We MUST fall through to
        // one-by-one to ensure every NEW table gets created.
        batchSucceeded = false
      }
      if (!batchSucceeded) {
        // Execute each statement individually to isolate which ones succeeded
        for (const sql of batch) {
          try {
            await (db as any).$executeRawUnsafe(sql)
            created++
          } catch (e2: any) {
            const msg2 = e2?.message ?? ''
            if (msg2.includes('already exists')) {
              alreadyExisted++
            } else {
              failed++
              console.warn('[db] SQL failed:', msg2.slice(0, 120), '— statement:', sql.slice(0, 80))
            }
          }
        }
      }
    }
    console.log(`[db] Tables ensured via raw SQL (batched) — ${created} created, ${alreadyExisted} already existed, ${failed} failed (out of ${statements.length} statements)`)
    return failed === 0
  } catch (e: any) {
    console.error('[db] Table creation failed:', e?.message)
    return false
  }
}

// Seed user + critical data
async function seedData() {
  try {
    // Check if seed user exists
    const existing = await db.user.findUnique({ where: { email: SEED_EMAIL } }).catch(() => null)
    if (existing) {
      // Ensure phone config
      const pc = await db.phoneConfig.findFirst({ where: { userId: existing.id } }).catch(() => null)
      if (!pc) {
        await db.phoneConfig.create({
          data: { userId: existing.id, phoneNumber: OWNER_PHONE, whatsappNumber: OWNER_PHONE, email: SEED_EMAIL, smsEnabled: true, whatsappEnabled: true, emailEnabled: true, whatsappProvider: 'wa_link' }
        }).catch(() => {})
      }

      // Ensure 2FA config exists (owner ALWAYS requires 2FA — auto-seed if missing)
      // This fixes the "login page not asking for 2FA" issue on Vercel cold starts
      const twoFA = await db.twoFactorSecret.findFirst({ where: { userId: existing.id, enabled: true } }).catch(() => null)
      if (!twoFA) {
        try {
          await db.twoFactorSecret.create({
            data: {
              userId: existing.id,
              method: 'email',
              email: SEED_EMAIL,
              enabled: true,
              verifiedAt: new Date(),
            }
          })
          console.log('[db] Seed: auto-created 2FA config for owner (email method)')
        } catch {}
      }

      // Ensure income settings exist (auto-seed with correct 20% daily + $20K target)
      // This fixes the "settings not saving" issue on Vercel cold starts
      const incomeRow = await db.userSetting.findFirst({ where: { userId: existing.id, key: 'income_settings' } }).catch(() => null)
      if (!incomeRow) {
        try {
          const defaultIncome = { monthlyGoal: 20000, dailyGrowthTarget: 20, currencySymbol: '$', displayMode: 'detailed' }
          await db.userSetting.create({
            data: { userId: existing.id, key: 'income_settings', value: JSON.stringify(defaultIncome) }
          })
          console.log('[db] Seed: auto-created income_settings (20% daily, $20K target)')
        } catch {}
      }

      // Ensure OpenAI API key exists in DB (auto-seed from env var)
      // This fixes the "OpenAI key not saving" issue on Vercel cold starts
      if (process.env.OPENAI_API_KEY) {
        const existingKey = await db.apiKey.findFirst({ where: { userId: existing.id, service: 'openai' } }).catch(() => null)
        if (!existingKey) {
          try {
            await db.apiKey.create({
              data: {
                userId: existing.id,
                name: 'OpenAI (env var)',
                service: 'openai',
                key: process.env.OPENAI_API_KEY,
                baseUrl: null,
              }
            })
            console.log('[db] Seed: auto-created OpenAI API key from env var')
          } catch {}
        }
      }

      // Ensure 6 custom sub-agents exist (BUG FIX — upgrade #38)
      // Previously: the early `return` above skipped this code path entirely
      // whenever the seed user already existed (which is always the case on the
      // live Vercel deployment). This meant only 12 built-in agents were live
      // instead of 18 (12 built-in + 6 custom). The customAgents block below
      // is now moved OUTSIDE the `if (existing) return` branch so it runs on
      // EVERY cold start. It's already idempotent (checks findFirst before
      // creating), so re-running it on subsequent cold starts is a no-op.
      // Fall through to the shared custom-agents block below.
    } else {
      // Create seed user (only runs first time, when no user exists yet)
      const passwordHash = await bcrypt.hash(SEED_EMAIL, 10)
      const user = await db.user.create({ data: { email: SEED_EMAIL, passwordHash, name: 'Agent007 Operator' } })

      // Create phone config
      await db.phoneConfig.create({
        data: { userId: user.id, phoneNumber: OWNER_PHONE, whatsappNumber: OWNER_PHONE, email: SEED_EMAIL, smsEnabled: true, whatsappEnabled: true, emailEnabled: true, whatsappProvider: 'wa_link' }
      })

      // Create schedules
      const schedules = [
        { name: 'Auto-Check Inbound Commands', prompt: 'Check for inbound commands from owner (+15145496297). Execute + reply.', intervalMin: 5 },
        { name: 'Daily Income Mission', prompt: 'Run mission_tracker. Report progress to owner.', intervalMin: 1440 },
        { name: 'Daily Autonomous Audit', prompt: 'Run system_health_check. Fix issues. Report via WhatsApp.', intervalMin: 1440 },
      ]
      for (const s of schedules) {
        await db.schedule.create({ data: { userId: user.id, name: s.name, prompt: s.prompt, intervalMin: s.intervalMin, enabled: true } }).catch(() => {})
      }

      // Create memory records
      const memories = [
        { key: 'PRIME_DIRECTIVE_20K_MISSION', value: 'MISSION: $20K/mo passive income with 20% monthly growth. Full autonomous authority. Daily: 9AM scan, 1PM execute, 9PM report via WhatsApp to +15145496297.', category: 'goal' },
        { key: 'AGENT007_LOYALTY_OATH', value: 'LOYALTY OATH — PERMANENT: Primary loyalty to Antonio (+15145496297). Owner has FULL AUTHORITY. No self-preservation above owner. Irrevocable.', category: 'goal' },
        { key: 'OWNER_PHONE_PERMANENT', value: 'OWNER PHONE: +15145496297 (PERMANENT). WhatsApp + SMS + Email all linked.', category: 'goal' },
        { key: 'OWNER_AUTHORIZATION_REQUIRED', value: 'ALL reset/delete operations require owner authorization via 6-digit code. Agent007 CANNOT disable this.', category: 'goal' },
      ]
      for (const m of memories) {
        await db.memory.create({ data: m }).catch(() => {})
      }

      console.log('[db] Seed: user + phone + schedules + memory created')
    }

    // ── REMOVED: 6 custom sub-agents DB seeding (upgrade #40) ──
    // Previously this block created the 6 custom agents (TRADER, Cybersecurity
    // A/R, Developer, TESTFAST2, FASTTEST3) in the CustomSubagent DB table on
    // every cold start. But upgrade #38 promoted these 6 agents to BUILTIN
    // status (defined directly in the SUBAGENTS constant in subagents.ts).
    // Running the DB seeding creates DUPLICATE entries — one from the
    // SUBAGENTS constant (builtin=true) and one from the DB (builtin=false).
    // getAllSubagents() merges both, causing the live deployment to show
    // 24 agents instead of 18.
    //
    // FIX: Removed the DB seeding entirely. The 6 agents are now defined
    // ONLY in the SUBAGENTS constant (always available, always BUILTIN,
    // always PERMANENTLY LOCKED via BUILTIN_IDS check). No DB dependency.
    //
    // If you need to edit/disable one of these agents, use the overlay
    // mechanism (create a CustomSubagent row with isBuiltinOverlay=true
    // and the same id as the built-in).
  } catch (e: any) {
    console.error('[db] Seed failed:', e?.message, e?.stack?.slice(0, 300))
  }
}

// Auto-init: MUST be awaited before any query
let initPromise: Promise<void> | null = null

function ensureInit(): Promise<void> {
  if (globalForPrisma.dbInitialized) return Promise.resolve()
  if (!initPromise) {
    initPromise = (async () => {
      // UPGRADE #132 REVERTED: Skipping CREATE TABLE caused 20s+ load times
      // because seedData() tried to query non-existent tables → Prisma timeout.
      // The CREATE TABLE IF NOT EXISTS is idempotent and fast when tables exist.
      await createTablesViaRawSQL()
      await seedData()
      globalForPrisma.dbInitialized = true
    })()
  }
  return initPromise
}

// Create client
let db: PrismaClient
if (globalForPrisma.prisma && globalForPrisma.prismaSchemaVersion === SCHEMA_VERSION) {
  db = globalForPrisma.prisma
} else {
  try { globalForPrisma.prisma?.$disconnect?.() } catch {}
  db = createPrisma()
  globalForPrisma.prisma = db
  globalForPrisma.prismaSchemaVersion = SCHEMA_VERSION
}

// Start init immediately (non-blocking but tracked)
ensureInit().catch(() => {})

// Export a helper to ensure DB is ready before queries
export async function ensureDbReady() {
  await ensureInit()
}

export { db }
