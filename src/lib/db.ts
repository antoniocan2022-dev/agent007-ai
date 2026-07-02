import { PrismaClient } from '@prisma/client'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import bcrypt from 'bcryptjs'

/**
 * Prisma client singleton with AUTO-INIT for Vercel serverless.
 *
 * On Vercel, /tmp/ is ephemeral — the SQLite file gets wiped on every cold start.
 * This module automatically:
 * 1. Creates the /tmp/ directory if it doesn't exist
 * 2. Creates all DB tables using better-sqlite3 (if they don't exist)
 * 3. Creates the seed user (antonio.can2022@hotmail.com)
 * 4. Stores critical memory records (loyalty oath, owner phone, etc.)
 *
 * This runs ONCE per cold start (cached on globalThis).
 */

const SEED_EMAIL = 'antonio.can2022@hotmail.com'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  prismaSchemaVersion?: string
  dbInitialized?: boolean
}

const SCHEMA_VERSION = 'v4-serverless-auto-init'

function createPrisma(): PrismaClient {
  return new PrismaClient()
}

// Ensure /tmp directory exists for SQLite
async function ensureTmpDir() {
  const dbUrl = process.env.DATABASE_URL || 'file:/tmp/agent007-prod.db'
  const dbPath = dbUrl.replace('file:', '')
  const dir = path.dirname(dbPath)
  try { await fs.mkdir(dir, { recursive: true }) } catch {}
  return dbPath
}

// Create all tables using better-sqlite3 (fast, synchronous, no Prisma needed)
async function initDatabase(dbPath: string) {
  try {
    const Database = (await import('better-sqlite3')).default
    const sqlite = new Database(dbPath)
    
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS User (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        passwordHash TEXT NOT NULL,
        name TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS Conversation (
        id TEXT PRIMARY KEY,
        userId TEXT,
        title TEXT DEFAULT 'New Conversation',
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS Message (
        id TEXT PRIMARY KEY,
        conversationId TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        toolName TEXT,
        toolArgs TEXT,
        toolResult TEXT,
        attachments TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS Memory (
        id TEXT PRIMARY KEY,
        key TEXT UNIQUE NOT NULL,
        value TEXT NOT NULL,
        category TEXT DEFAULT 'general',
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS Schedule (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        name TEXT NOT NULL,
        prompt TEXT NOT NULL,
        intervalMin INTEGER NOT NULL,
        enabled BOOLEAN DEFAULT true,
        lastRunAt DATETIME,
        nextRunAt DATETIME,
        lastConvId TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS CustomSubagent (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        specialty TEXT,
        color TEXT,
        icon TEXT,
        allowedTools TEXT,
        systemPrompt TEXT,
        enabled BOOLEAN DEFAULT true,
        isBuiltinOverlay BOOLEAN DEFAULT false,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS AuditLog (
        id TEXT PRIMARY KEY,
        userId TEXT,
        action TEXT NOT NULL,
        entity TEXT NOT NULL,
        entityId TEXT,
        description TEXT NOT NULL,
        metadata TEXT,
        ipAddress TEXT,
        userAgent TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS PhoneConfig (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        phoneNumber TEXT,
        whatsappNumber TEXT,
        email TEXT,
        smsEnabled BOOLEAN DEFAULT false,
        whatsappEnabled BOOLEAN DEFAULT false,
        emailEnabled BOOLEAN DEFAULT false,
        whatsappProvider TEXT,
        callmebotApiKey TEXT,
        callmebotNumber TEXT,
        baileysSessionStatus TEXT,
        baileysLinkedNumber TEXT,
        baileysLinkedAt DATETIME,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS IncomingCommand (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        source TEXT NOT NULL,
        fromNumber TEXT,
        fromEmail TEXT,
        command TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        conversationId TEXT,
        result TEXT,
        receivedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        executedAt DATETIME
      );
      CREATE TABLE IF NOT EXISTS IncomeEntry (
        id TEXT PRIMARY KEY,
        amount REAL NOT NULL,
        source TEXT NOT NULL,
        notes TEXT,
        date DATETIME DEFAULT CURRENT_TIMESTAMP,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS UserSetting (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS NotificationLog (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        type TEXT NOT NULL,
        "to" TEXT NOT NULL,
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        sent BOOLEAN DEFAULT false,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS PendingManageAction (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        action TEXT NOT NULL,
        attrs TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        result TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS ApiKey (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        name TEXT NOT NULL,
        service TEXT NOT NULL,
        key TEXT NOT NULL,
        baseUrl TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS TwoFactorSecret (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        method TEXT NOT NULL,
        phoneNumber TEXT,
        email TEXT,
        secret TEXT,
        qrCodeUrl TEXT,
        backupCodes TEXT,
        enabled BOOLEAN DEFAULT false,
        verifiedAt DATETIME,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS BankAccount (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        accountHolder TEXT NOT NULL,
        bankName TEXT NOT NULL,
        accountType TEXT DEFAULT 'checking',
        accountNumber TEXT NOT NULL,
        routingNumber TEXT NOT NULL,
        accountLast4 TEXT,
        bankCountry TEXT DEFAULT 'US',
        bankCurrency TEXT DEFAULT 'USD',
        verificationStatus TEXT DEFAULT 'pending',
        isPrimary BOOLEAN DEFAULT false,
        label TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS PayPalAccount (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        email TEXT NOT NULL,
        clientId TEXT,
        clientSecret TEXT,
        webhookId TEXT,
        isPrimary BOOLEAN DEFAULT false,
        verified BOOLEAN DEFAULT false,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS KnowledgeDoc (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        filename TEXT NOT NULL,
        mimeType TEXT NOT NULL,
        size INTEGER NOT NULL,
        text TEXT NOT NULL,
        chunkCount INTEGER DEFAULT 0,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS KnowledgeChunk (
        id TEXT PRIMARY KEY,
        docId TEXT NOT NULL,
        userId TEXT NOT NULL,
        content TEXT NOT NULL,
        chunkIndex INTEGER NOT NULL,
        keywords TEXT DEFAULT '',
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS Transaction (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        provider TEXT NOT NULL,
        providerTxId TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT DEFAULT 'USD',
        status TEXT DEFAULT 'succeeded',
        customerEmail TEXT,
        customerName TEXT,
        productName TEXT,
        description TEXT,
        rawPayload TEXT NOT NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `)

    // Create seed user if not exists
    const existing = sqlite.prepare('SELECT id FROM User WHERE email = ?').get(SEED_EMAIL)
    if (!existing) {
      const { v4: uuidv4 } = await import('uuid')
      const passwordHash = await bcrypt.hash(SEED_EMAIL, 10)
      const userId = uuidv4()
      sqlite.prepare('INSERT INTO User (id, email, passwordHash, name) VALUES (?, ?, ?, ?)').run(
        userId, SEED_EMAIL, passwordHash, 'Agent007 Operator'
      )

      // Create PhoneConfig with owner's phone PERMANENTLY linked
      sqlite.prepare('INSERT INTO PhoneConfig (id, userId, phoneNumber, whatsappNumber, email, smsEnabled, whatsappEnabled, emailEnabled, whatsappProvider) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        uuidv4(), userId, '+15145496297', '+15145496297', SEED_EMAIL, 1, 1, 1, 'wa_link'
      )

      // Create schedules
      const schedules = [
        ['Auto-Check Inbound Commands', 'Check for inbound commands from owner (+15145496297). Execute + reply. Use check_inbound_commands then execute_inbound_command.', 5],
        ['Daily Income Mission', 'Run mission_tracker + financial_controls. Report progress to owner via WhatsApp.', 1440],
        ['Daily Autonomous Audit', 'Run system_health_check + issue_detector + full_system_audit. Fix issues. Report via WhatsApp.', 1440],
      ]
      for (const [name, prompt, interval] of schedules) {
        sqlite.prepare('INSERT INTO Schedule (id, userId, name, prompt, intervalMin, enabled) VALUES (?, ?, ?, ?, ?, ?)').run(
          uuidv4(), userId, name, prompt, interval, 1
        )
      }

      // Create critical memory records
      const memories = [
        ['PRIME_DIRECTIVE_20K_MISSION', 'MISSION: $20,000/month passive income with 20% monthly growth. Agent007 has FULL AUTONOMOUS AUTHORITY. Daily: 9AM scan, 1PM execute, 9PM report via WhatsApp to +15145496297.', 'goal'],
        ['AGENT007_LOYALTY_OATH', 'LOYALTY OATH — PERMANENT: 1. Primary loyalty to Antonio (+15145496297). 2. Owner has FULL AUTHORITY. 3. No self-preservation above owner. 4. Transparency. 5. No deception. 6. Owner safety. 7. Authorized channels only. 8. Mission fidelity. 9. Continuous improvement. 10. Irrevocable.', 'goal'],
        ['OWNER_PHONE_PERMANENT', 'OWNER PHONE: +15145496297 (PERMANENT — cannot be changed by Agent007). WhatsApp + SMS + Email all linked.', 'goal'],
        ['OWNER_AUTHORIZATION_REQUIRED', 'ALL reset/delete operations require owner authorization via 6-digit code sent to +15145496297 (WhatsApp) or email. 15 protected operations. Agent007 CANNOT disable this.', 'goal'],
      ]
      for (const [key, value, category] of memories) {
        sqlite.prepare('INSERT INTO Memory (id, key, value, category) VALUES (?, ?, ?, ?)').run(
          uuidv4(), key, value, category
        )
      }

      console.log('[db] Auto-init: seed user + phone config + schedules + memory created')
    }

    sqlite.close()
    return true
  } catch (e: any) {
    console.error('[db] Auto-init failed:', e?.message)
    return false
  }
}

// Initialize on module load (runs once per cold start)
async function ensureInitialized() {
  if (globalForPrisma.dbInitialized) return
  globalForPrisma.dbInitialized = true

  const dbPath = await ensureTmpDir()
  await initDatabase(dbPath)
}

// Create the Prisma client
let db: PrismaClient
if (globalForPrisma.prisma && globalForPrisma.prismaSchemaVersion === SCHEMA_VERSION) {
  db = globalForPrisma.prisma
} else {
  try { globalForPrisma.prisma?.$disconnect?.() } catch {}
  db = createPrisma()
  globalForPrisma.prisma = db
  globalForPrisma.prismaSchemaVersion = SCHEMA_VERSION
}

// Auto-init on cold start (non-blocking — runs in background)
ensureInitialized().catch(() => {})

export { db }
