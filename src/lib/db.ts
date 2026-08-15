import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { v4 as uuidv4 } from 'uuid'

// ── UPGRADE #60 — Postgres support ─────────────────────────────────────
// DATABASE_URL must be PostgreSQL at runtime. Build-time module evaluation
// must remain side-effect free because `next build` has no runtime database.
const isNextProductionBuild = process.env.NEXT_PHASE === 'phase-production-build'

;(function validatePostgresDatabaseUrl() {
  const current = process.env.DATABASE_URL
  if (!current) {
    if (isNextProductionBuild) return
    console.error(
      '[db] FATAL: DATABASE_URL env var is not set. ' +
        'Set it to a Postgres connection string (postgresql://...).'
    )
    return
  }

  if (!current.startsWith('postgres://') && !current.startsWith('postgresql://')) {
    if (isNextProductionBuild) return
    console.error(
      '[db] FATAL: DATABASE_URL must be a Postgres URL (start with postgres:// or postgresql://).'
    )
    return
  }

  if (!isNextProductionBuild) {
    console.log('[db] DATABASE_URL is Postgres-compatible ✅')

    const hasPooler =
      current.includes('pgbouncer=true') ||
      current.includes('accelerate=true') ||
      current.includes('-pooler.') ||
      current.includes('vercel-storage.com')

    if (!hasPooler) {
      console.warn(
        '[db] WARNING: DATABASE_URL does not appear to use a connection pooler. ' +
          'Use the provider pooled connection string for Vercel serverless workloads.'
      )
    } else {
      console.log('[db] DATABASE_URL appears to use a pooler ✅')
    }
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
async function createTablesViaRawSQL() {
  try {
    const statements = [
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
    ]

    // Keep the existing schema SQL authoritative; these core tables are the
    // minimum needed before user seeding. Prisma migrations/db-push remain the
    // preferred schema lifecycle mechanism.
    let created = 0
    let failed = 0
    const BATCH_SIZE = 8
    for (let i = 0; i < statements.length; i += BATCH_SIZE) {
      const batch = statements.slice(i, i + BATCH_SIZE)
      try {
        await (db as any).$executeRawUnsafe(batch.join(';\n'))
        created += batch.length
      } catch {
        for (const sql of batch) {
          try {
            await (db as any).$executeRawUnsafe(sql)
            created++
          } catch (e2: any) {
            const msg = e2?.message ?? ''
            if (!msg.includes('already exists')) {
              failed++
              console.warn('[db] SQL failed:', msg.slice(0, 120))
            }
          }
        }
      }
    }
    console.log(`[db] Core tables ensured — ${created} processed, ${failed} failed`)
    return failed === 0
  } catch (e: any) {
    console.error('[db] Table creation failed:', e?.message)
    return false
  }
}

async function seedData() {
  try {
    const existing = await db.user.findUnique({ where: { email: SEED_EMAIL } }).catch(() => null)
    if (existing) {
      const [pc, twoFA, incomeRow, existingKey] = await Promise.all([
        db.phoneConfig.findFirst({ where: { userId: existing.id } }).catch(() => null),
        db.twoFactorSecret.findFirst({ where: { userId: existing.id, enabled: true } }).catch(() => null),
        db.userSetting.findFirst({ where: { userId: existing.id, key: 'income_settings' } }).catch(() => null),
        process.env.OPENAI_API_KEY
          ? db.apiKey.findFirst({ where: { userId: existing.id, service: 'openai' } }).catch(() => null)
          : Promise.resolve(null),
      ])

      if (!pc) {
        await db.phoneConfig.create({
          data: { userId: existing.id, phoneNumber: OWNER_PHONE, whatsappNumber: OWNER_PHONE, email: SEED_EMAIL, smsEnabled: true, whatsappEnabled: true, emailEnabled: true, whatsappProvider: 'wa_link' },
        }).catch(() => {})
      }

      if (!twoFA) {
        await db.twoFactorSecret.create({
          data: { userId: existing.id, method: 'email', email: SEED_EMAIL, enabled: true, verifiedAt: new Date() },
        }).catch(() => {})
      }

      if (!incomeRow) {
        const defaultIncome = { monthlyGoal: 20000, dailyGrowthTarget: 20, currencySymbol: '$', displayMode: 'detailed' }
        await db.userSetting.create({ data: { userId: existing.id, key: 'income_settings', value: JSON.stringify(defaultIncome) } }).catch(() => {})
      }

      if (process.env.OPENAI_API_KEY && !existingKey) {
        await db.apiKey.create({
          data: { userId: existing.id, name: 'OpenAI (env var)', service: 'openai', key: process.env.OPENAI_API_KEY, baseUrl: null },
        }).catch(() => {})
      }
    } else {
      const passwordHash = await bcrypt.hash(SEED_EMAIL, 10)
      const user = await db.user.create({ data: { email: SEED_EMAIL, passwordHash, name: 'Agent007 Operator' } })
      await db.phoneConfig.create({
        data: { userId: user.id, phoneNumber: OWNER_PHONE, whatsappNumber: OWNER_PHONE, email: SEED_EMAIL, smsEnabled: true, whatsappEnabled: true, emailEnabled: true, whatsappProvider: 'wa_link' },
      })
    }
  } catch (e: any) {
    console.error('[db] Seed failed:', e?.message)
  }

  try {
    const seedUser = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
    if (seedUser) {
      const { injectCharterIntoKB } = await import('./charter-injector')
      await injectCharterIntoKB(seedUser.id)
    }
  } catch (e: any) {
    console.error('[db] Charter injection failed:', e?.message)
  }
}

let initPromise: Promise<void> | null = null

function ensureInit(): Promise<void> {
  // NEVER initialize or connect to the database while Next.js is collecting
  // page data during `next build`. All DB work belongs to runtime requests.
  if (isNextProductionBuild) return Promise.resolve()
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

let db: PrismaClient
if (globalForPrisma.prisma && globalForPrisma.prismaSchemaVersion === SCHEMA_VERSION) {
  db = globalForPrisma.prisma
} else {
  try { globalForPrisma.prisma?.$disconnect?.() } catch {}
  db = createPrisma()
  globalForPrisma.prisma = db
  globalForPrisma.prismaSchemaVersion = SCHEMA_VERSION
}

// Do not start initialization during build. Runtime initialization remains
// lazy and is explicitly awaited by ensureDbReady() where required.
if (!isNextProductionBuild) {
  ensureInit().catch(() => {})
}

export async function ensureDbReady() {
  await ensureInit()
}

export { db }
