import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { v4 as uuidv4 } from 'uuid'

// ── UPGRADE #58 — Default DATABASE_URL ─────────────────────────────────
// On Vercel, the DATABASE_URL env var may be missing or pointing to a
// Postgres URL while the Prisma schema is configured for SQLite. This causes
// "URL must start with the protocol `file:`" errors that break:
//   - /api/system/backup-download (500)
//   - /api/system/seed-agents (500)
//   - /api/system/audit (500)
//   - All endpoints that touch Prisma
//
// FIX: If DATABASE_URL is missing or doesn't start with "file:", set it to
// a default ephemeral SQLite path BEFORE Prisma initializes. The Prisma
// client validates this URL at construction time, so we must set it before
// the first `new PrismaClient()` call.
//
// On Vercel, /tmp is the only writable directory on cold start, so we use
// `/tmp/agent007-<sandbox-id>.db` as the default. This DB is EPHEMERAL —
// data does not persist across cold starts — but it lets the app boot and
// serve requests instead of 500ing.
//
// To get PERSISTENT data on Vercel, the owner must set DATABASE_URL to a
// real Postgres URL AND change `provider = "sqlite"` to `provider = "postgres"`
// in prisma/schema.prisma, then redeploy. (See POSTGRES-SETUP.md.)
;(function ensureDefaultDatabaseUrl() {
  const current = process.env.DATABASE_URL
  if (!current || (!current.startsWith('file:') && !current.startsWith('postgres'))) {
    // Use /tmp on Vercel (writable but ephemeral), local path otherwise
    const isVercel = !!(process.env.VERCEL || process.env.NOW)
    const defaultPath = isVercel
      ? `file:/tmp/agent007-${process.env.VERCEL_DEPLOYMENT_ID ?? 'dev'}.db`
      : 'file:/home/z/my-project/db/custom.db'
    process.env.DATABASE_URL = defaultPath
    console.log(`[db] DATABASE_URL was missing/invalid — defaulting to ${defaultPath}`)
  }
})()

const SEED_EMAIL = 'antonio.can2022@hotmail.com'

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
    // SQLite raw DDL — Prisma executes these directly
    const statements = [
      // ── Core 17 tables (original v6 set) ───────────────────────────────
      'CREATE TABLE IF NOT EXISTS User (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, passwordHash TEXT NOT NULL, name TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP)',
      'CREATE TABLE IF NOT EXISTS Conversation (id TEXT PRIMARY KEY, userId TEXT, title TEXT DEFAULT \'New Conversation\', createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP)',
      'CREATE TABLE IF NOT EXISTS Message (id TEXT PRIMARY KEY, conversationId TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, toolName TEXT, toolArgs TEXT, toolResult TEXT, attachments TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)',
      'CREATE TABLE IF NOT EXISTS Memory (id TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, value TEXT NOT NULL, category TEXT DEFAULT \'general\', createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP)',
      'CREATE TABLE IF NOT EXISTS Schedule (id TEXT PRIMARY KEY, userId TEXT NOT NULL, name TEXT NOT NULL, prompt TEXT NOT NULL, intervalMin INTEGER NOT NULL, enabled BOOLEAN DEFAULT 1, lastRunAt DATETIME, nextRunAt DATETIME, lastConvId TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP)',
      'CREATE TABLE IF NOT EXISTS CustomSubagent (id TEXT PRIMARY KEY, userId TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL, specialty TEXT, color TEXT, icon TEXT, allowedTools TEXT, systemPrompt TEXT, enabled BOOLEAN DEFAULT 1, isBuiltinOverlay BOOLEAN DEFAULT 0, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP)',
      'CREATE TABLE IF NOT EXISTS AuditLog (id TEXT PRIMARY KEY, userId TEXT, action TEXT NOT NULL, entity TEXT NOT NULL, entityId TEXT, description TEXT NOT NULL, metadata TEXT, ipAddress TEXT, userAgent TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)',
      'CREATE TABLE IF NOT EXISTS PhoneConfig (id TEXT PRIMARY KEY, userId TEXT NOT NULL, phoneNumber TEXT, whatsappNumber TEXT, email TEXT, smsEnabled BOOLEAN DEFAULT 0, whatsappEnabled BOOLEAN DEFAULT 0, emailEnabled BOOLEAN DEFAULT 0, whatsappProvider TEXT, callmebotApiKey TEXT, callmebotNumber TEXT, baileysSessionStatus TEXT, baileysLinkedNumber TEXT, baileysLinkedAt DATETIME, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP)',
      'CREATE TABLE IF NOT EXISTS IncomingCommand (id TEXT PRIMARY KEY, userId TEXT NOT NULL, source TEXT NOT NULL, fromNumber TEXT, fromEmail TEXT, command TEXT NOT NULL, status TEXT DEFAULT \'pending\', conversationId TEXT, result TEXT, receivedAt DATETIME DEFAULT CURRENT_TIMESTAMP, executedAt DATETIME)',
      'CREATE TABLE IF NOT EXISTS IncomeEntry (id TEXT PRIMARY KEY, amount REAL NOT NULL, source TEXT NOT NULL, notes TEXT, date DATETIME DEFAULT CURRENT_TIMESTAMP, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)',
      'CREATE TABLE IF NOT EXISTS UserSetting (id TEXT PRIMARY KEY, userId TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, UNIQUE(userId, key))',
      'CREATE TABLE IF NOT EXISTS NotificationLog (id TEXT PRIMARY KEY, userId TEXT NOT NULL, type TEXT NOT NULL, "to" TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, sent BOOLEAN DEFAULT 0, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)',
      'CREATE TABLE IF NOT EXISTS PendingManageAction (id TEXT PRIMARY KEY, userId TEXT NOT NULL, action TEXT NOT NULL, attrs TEXT NOT NULL, status TEXT DEFAULT \'pending\', result TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP)',
      'CREATE TABLE IF NOT EXISTS ApiKey (id TEXT PRIMARY KEY, userId TEXT NOT NULL, name TEXT NOT NULL, service TEXT NOT NULL, key TEXT NOT NULL, baseUrl TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP)',
      'CREATE TABLE IF NOT EXISTS TwoFactorSecret (id TEXT PRIMARY KEY, userId TEXT NOT NULL, method TEXT NOT NULL, phoneNumber TEXT, email TEXT, secret TEXT, qrCodeUrl TEXT, backupCodes TEXT, enabled BOOLEAN DEFAULT 0, verifiedAt DATETIME, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP)',
      'CREATE TABLE IF NOT EXISTS BankAccount (id TEXT PRIMARY KEY, userId TEXT NOT NULL, accountHolder TEXT NOT NULL, bankName TEXT NOT NULL, accountType TEXT DEFAULT \'checking\', accountNumber TEXT NOT NULL, routingNumber TEXT NOT NULL, accountLast4 TEXT, bankCountry TEXT DEFAULT \'US\', bankCurrency TEXT DEFAULT \'USD\', verificationStatus TEXT DEFAULT \'pending\', isPrimary BOOLEAN DEFAULT 0, label TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP)',
      'CREATE TABLE IF NOT EXISTS PayPalAccount (id TEXT PRIMARY KEY, userId TEXT NOT NULL, email TEXT NOT NULL, clientId TEXT, clientSecret TEXT, webhookId TEXT, isPrimary BOOLEAN DEFAULT 0, verified BOOLEAN DEFAULT 0, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP)',

      // ── Phase-2 business tables (16 new — fixes "database: fail" audit) ─
      'CREATE TABLE IF NOT EXISTS Customer (id TEXT PRIMARY KEY, userId TEXT NOT NULL, name TEXT NOT NULL, email TEXT, phone TEXT, company TEXT, status TEXT DEFAULT \'lead\', value REAL DEFAULT 0, source TEXT, notes TEXT, tags TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP)',
      'CREATE TABLE IF NOT EXISTS MarketingCampaign (id TEXT PRIMARY KEY, userId TEXT NOT NULL, name TEXT NOT NULL, channel TEXT, status TEXT DEFAULT \'draft\', budget REAL DEFAULT 0, spent REAL DEFAULT 0, leadsGenerated INTEGER DEFAULT 0, conversions INTEGER DEFAULT 0, revenue REAL DEFAULT 0, startDate DATETIME, endDate DATETIME, metadata TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP)',
      'CREATE TABLE IF NOT EXISTS Partnership (id TEXT PRIMARY KEY, userId TEXT NOT NULL, partnerName TEXT NOT NULL, partnerType TEXT, status TEXT DEFAULT \'proposed\', commissionRate REAL DEFAULT 0, revenueGenerated REAL DEFAULT 0, contactEmail TEXT, contactPhone TEXT, notes TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP)',
      'CREATE TABLE IF NOT EXISTS BusinessStrategy (id TEXT PRIMARY KEY, userId TEXT NOT NULL, phase TEXT, title TEXT NOT NULL, description TEXT, status TEXT DEFAULT \'planned\', priority TEXT DEFAULT \'medium\', progress REAL DEFAULT 0, targetDate DATETIME, completedAt DATETIME, metadata TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP)',
      'CREATE TABLE IF NOT EXISTS MissionTracker (id TEXT PRIMARY KEY, userId TEXT NOT NULL, metric TEXT NOT NULL, currentValue REAL NOT NULL, targetValue REAL NOT NULL, withoutImprovements REAL, withImprovements REAL, unit TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP)',
      'CREATE TABLE IF NOT EXISTS ServicePackage (id TEXT PRIMARY KEY, userId TEXT NOT NULL, name TEXT NOT NULL, description TEXT, category TEXT, priceMonthly REAL DEFAULT 0, priceOneTime REAL DEFAULT 0, deliveryTime TEXT, features TEXT, active BOOLEAN DEFAULT 1, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP)',
      'CREATE TABLE IF NOT EXISTS Opportunity (id TEXT PRIMARY KEY, userId TEXT NOT NULL, title TEXT NOT NULL, description TEXT, category TEXT, potential REAL, status TEXT DEFAULT \'new\', metadata TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP)',
      'CREATE TABLE IF NOT EXISTS Prediction (id TEXT PRIMARY KEY, userId TEXT NOT NULL, category TEXT, prediction TEXT, confidence REAL DEFAULT 0.5, timeframe TEXT, outcome TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)',
      'CREATE TABLE IF NOT EXISTS SystemHealth (id TEXT PRIMARY KEY, userId TEXT NOT NULL, component TEXT, status TEXT DEFAULT \'healthy\', details TEXT, autoRepaired BOOLEAN DEFAULT 0, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)',
      'CREATE TABLE IF NOT EXISTS MLModel (id TEXT PRIMARY KEY, userId TEXT NOT NULL, name TEXT NOT NULL, type TEXT, features TEXT, weights TEXT, accuracy REAL DEFAULT 0.0, trainSamples INTEGER DEFAULT 0, lastTrained DATETIME, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP)',
      'CREATE TABLE IF NOT EXISTS RiskRegister (id TEXT PRIMARY KEY, userId TEXT NOT NULL, category TEXT, description TEXT NOT NULL, likelihood INTEGER DEFAULT 3, impact INTEGER DEFAULT 3, score INTEGER DEFAULT 15, level TEXT DEFAULT \'medium\', mitigations TEXT, status TEXT DEFAULT \'active\', createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP)',
      'CREATE TABLE IF NOT EXISTS ComplianceCheck (id TEXT PRIMARY KEY, userId TEXT NOT NULL, country TEXT, regulation TEXT, status TEXT DEFAULT \'pending\', details TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)',
      'CREATE TABLE IF NOT EXISTS ContractDraft (id TEXT PRIMARY KEY, userId TEXT NOT NULL, title TEXT NOT NULL, type TEXT, parties TEXT, terms TEXT, status TEXT DEFAULT \'draft\', riskScore INTEGER DEFAULT 5, notes TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP)',
      'CREATE TABLE IF NOT EXISTS "Transaction" (id TEXT PRIMARY KEY, userId TEXT NOT NULL, provider TEXT NOT NULL, providerTxId TEXT NOT NULL, amount REAL NOT NULL, currency TEXT DEFAULT \'USD\', status TEXT DEFAULT \'succeeded\', customerEmail TEXT, customerName TEXT, productName TEXT, description TEXT, rawPayload TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(provider, providerTxId))',
      'CREATE TABLE IF NOT EXISTS KnowledgeDoc (id TEXT PRIMARY KEY, userId TEXT NOT NULL, filename TEXT NOT NULL, mimeType TEXT, size INTEGER, text TEXT, chunkCount INTEGER DEFAULT 0, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)',
      'CREATE TABLE IF NOT EXISTS KnowledgeChunk (id TEXT PRIMARY KEY, docId TEXT NOT NULL, userId TEXT NOT NULL, content TEXT, chunkIndex INTEGER, keywords TEXT DEFAULT \'\', createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)',
    ]
    let created = 0
    let alreadyExisted = 0
    let failed = 0
    for (const sql of statements) {
      try {
        await (db as any).$executeRawUnsafe(sql)
        created++
      } catch (e: any) {
        const msg = e?.message ?? ''
        if (msg.includes('already exists')) {
          alreadyExisted++
        } else {
          failed++
          console.warn('[db] SQL failed:', msg.slice(0, 120), '— statement:', sql.slice(0, 80))
        }
      }
    }
    console.log(`[db] Tables ensured via raw SQL — ${created} created, ${alreadyExisted} already existed, ${failed} failed (out of ${statements.length} statements)`)
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
          data: { userId: existing.id, phoneNumber: '+15145496297', whatsappNumber: '+15145496297', email: SEED_EMAIL, smsEnabled: true, whatsappEnabled: true, emailEnabled: true, whatsappProvider: 'wa_link' }
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
        data: { userId: user.id, phoneNumber: '+15145496297', whatsappNumber: '+15145496297', email: SEED_EMAIL, smsEnabled: true, whatsappEnabled: true, emailEnabled: true, whatsappProvider: 'wa_link' }
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
    console.error('[db] Seed failed:', e?.message)
  }
}

// Auto-init: MUST be awaited before any query
let initPromise: Promise<void> | null = null

function ensureInit(): Promise<void> {
  if (globalForPrisma.dbInitialized) return Promise.resolve()
  if (!initPromise) {
    initPromise = (async () => {
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
