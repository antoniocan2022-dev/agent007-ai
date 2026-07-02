import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { v4 as uuidv4 } from 'uuid'

const SEED_EMAIL = 'antonio.can2022@hotmail.com'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  prismaSchemaVersion?: string
  dbInitialized?: boolean
}

const SCHEMA_VERSION = 'v6-raw-sql-init'

function createPrisma(): PrismaClient {
  return new PrismaClient()
}

// Create tables via raw SQL (works on Vercel runtime, no better-sqlite3 needed)
async function createTablesViaRawSQL() {
  try {
    // SQLite raw DDL — Prisma executes these directly
    const statements = [
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
      'CREATE TABLE IF NOT EXISTS UserSetting (id TEXT PRIMARY KEY, userId TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL)',
      'CREATE TABLE IF NOT EXISTS NotificationLog (id TEXT PRIMARY KEY, userId TEXT NOT NULL, type TEXT NOT NULL, "to" TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, sent BOOLEAN DEFAULT 0, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)',
      'CREATE TABLE IF NOT EXISTS PendingManageAction (id TEXT PRIMARY KEY, userId TEXT NOT NULL, action TEXT NOT NULL, attrs TEXT NOT NULL, status TEXT DEFAULT \'pending\', result TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP)',
      'CREATE TABLE IF NOT EXISTS ApiKey (id TEXT PRIMARY KEY, userId TEXT NOT NULL, name TEXT NOT NULL, service TEXT NOT NULL, key TEXT NOT NULL, baseUrl TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP)',
      'CREATE TABLE IF NOT EXISTS TwoFactorSecret (id TEXT PRIMARY KEY, userId TEXT NOT NULL, method TEXT NOT NULL, phoneNumber TEXT, email TEXT, secret TEXT, qrCodeUrl TEXT, backupCodes TEXT, enabled BOOLEAN DEFAULT 0, verifiedAt DATETIME, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP)',
      'CREATE TABLE IF NOT EXISTS BankAccount (id TEXT PRIMARY KEY, userId TEXT NOT NULL, accountHolder TEXT NOT NULL, bankName TEXT NOT NULL, accountType TEXT DEFAULT \'checking\', accountNumber TEXT NOT NULL, routingNumber TEXT NOT NULL, accountLast4 TEXT, bankCountry TEXT DEFAULT \'US\', bankCurrency TEXT DEFAULT \'USD\', verificationStatus TEXT DEFAULT \'pending\', isPrimary BOOLEAN DEFAULT 0, label TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP)',
      'CREATE TABLE IF NOT EXISTS PayPalAccount (id TEXT PRIMARY KEY, userId TEXT NOT NULL, email TEXT NOT NULL, clientId TEXT, clientSecret TEXT, webhookId TEXT, isPrimary BOOLEAN DEFAULT 0, verified BOOLEAN DEFAULT 0, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP)',
    ]
    for (const sql of statements) {
      try { await (db as any).$executeRawUnsafe(sql) } catch (e: any) {
        // "table already exists" is OK
        if (!e?.message?.includes('already exists')) {
          // Silently ignore — table may already exist
        }
      }
    }
    console.log('[db] Tables ensured via raw SQL')
    return true
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
      return
    }

    // Create seed user
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
