import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hashPassword, SEED_EMAIL } from '@/lib/auth'
import { PrismaClient } from '@prisma/client'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const results: string[] = []
  
  // Create tables using raw SQL (for Vercel serverless SQLite)
  try {
    const { promises: fs } = await import('node:fs')
    const path = await import('node:path')
    const dbPath = process.env.DATABASE_URL?.replace('file:', '') || '/tmp/agent007-prod.db'
    const dbDir = path.dirname(dbPath)
    try { await fs.mkdir(dbDir, { recursive: true }) } catch {}
    
    // Open SQLite directly and create tables
    const Database = (await import('better-sqlite3')).default
    const sqlite = new Database(dbPath)
    
    // Create all tables
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
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (conversationId) REFERENCES Conversation(id) ON DELETE CASCADE
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
    `)
    results.push('✅ Tables created')
    sqlite.close()
  } catch (e: any) {
    results.push(`❌ Table creation: ${e?.message}`)
  }
  
  // Create seed user
  try {
    const bcrypt = await import('bcryptjs')
    const passwordHash = await bcrypt.hash(SEED_EMAIL, 10)
    const { v4: uuidv4 } = await import('uuid')
    
    // Use raw SQL to avoid Prisma schema mismatch
    const Database = (await import('better-sqlite3')).default
    const dbPath = process.env.DATABASE_URL?.replace('file:', '') || '/tmp/agent007-prod.db'
    const sqlite = new Database(dbPath)
    
    const existing = sqlite.prepare('SELECT id FROM User WHERE email = ?').get(SEED_EMAIL)
    if (existing) {
      results.push('✅ Seed user: already exists')
    } else {
      sqlite.prepare('INSERT INTO User (id, email, passwordHash, name) VALUES (?, ?, ?, ?)').run(
        uuidv4(), SEED_EMAIL, passwordHash, 'Agent007 Operator'
      )
      results.push('✅ Seed user: created')
    }
    
    // Also store key memory records
    const memCount = sqlite.prepare('SELECT COUNT(*) as count FROM Memory').get() as any
    results.push(`✅ Memory records: ${memCount?.count || 0}`)
    
    sqlite.close()
  } catch (e: any) {
    results.push(`❌ Seed user: ${e?.message}`)
  }
  
  return NextResponse.json({ ok: true, results, dbUrl: process.env.DATABASE_URL })
}
