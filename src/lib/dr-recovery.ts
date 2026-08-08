import { createCipheriv, createDecipheriv, createHash } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { BACKUP_TABLES, inspectBackupV2 } from '@/lib/backup-v2'

let recoveryClient: PrismaClient | null = null

function getRecoveryUrl(): string {
  const recoveryUrl = process.env.AGENT007_DR_DATABASE_URL?.trim()
  if (!recoveryUrl) throw new Error('AGENT007_DR_DATABASE_URL is not configured')
  if (!/^postgres(?:ql)?:\/\//i.test(recoveryUrl)) throw new Error('AGENT007_DR_DATABASE_URL must be a PostgreSQL URL')

  const productionUrl = process.env.DATABASE_URL?.trim()
  if (productionUrl && recoveryUrl === productionUrl) {
    throw new Error('DR safety stop: recovery database URL matches production DATABASE_URL')
  }
  return recoveryUrl
}

function getRecoveryClient(): PrismaClient {
  if (!recoveryClient) {
    recoveryClient = new PrismaClient({ datasources: { db: { url: getRecoveryUrl() } } })
  }
  return recoveryClient
}

function getEncryptionKey(): Buffer | null {
  const raw = process.env.BACKUP_ENCRYPTION_KEY?.trim()
  if (!raw) return null
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex')
  return createHash('sha256').update(raw, 'utf8').digest()
}

function decryptSecret(payload: string): unknown {
  const key = getEncryptionKey()
  if (!key) throw new Error('BACKUP_ENCRYPTION_KEY is required to restore encrypted secrets')
  const [ivB64, tagB64, dataB64] = payload.split('.')
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Invalid encrypted secret envelope')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64url')),
    decipher.final(),
  ])
  return JSON.parse(plaintext.toString('utf8'))
}

const RESTORE_ORDER = [
  'User', 'AuditLog', 'UserSetting', 'ApiKey', 'BankAccount', 'BusinessStrategy', 'ComplianceCheck',
  'ContractDraft', 'Customer', 'IncomeEntry', 'IncomingCommand', 'KnowledgeDoc', 'KnowledgeChunk',
  'MLModel', 'MarketingCampaign', 'Memory', 'Opportunity', 'Partnership', 'PayPalAccount',
  'PendingManageAction', 'PhoneConfig', 'Prediction', 'RiskProfile', 'RiskRegister', 'ScalingPlan',
  'ServicePackage', 'SystemHealth', 'Transaction', 'TwoFactorSecret', 'Experiment',
  'PlatformConnection', 'MissionTracker', 'SentimentLog', 'Schedule', 'CustomSubagent',
  'Conversation', 'Message', 'NotificationLog',
] as const

export async function inspectRecoveryTarget(): Promise<{ target: 'recovery'; connected: boolean; models: number }> {
  const db = getRecoveryClient()
  await db.$queryRawUnsafe('SELECT 1')
  return { target: 'recovery', connected: true, models: RESTORE_ORDER.length }
}

export async function restoreBackupToRecovery(input: any, dryRun = true) {
  const inspection = await inspectBackupV2(input)
  if (!inspection.valid) throw new Error(`Backup validation failed: ${inspection.errors.join('; ')}`)
  if (BACKUP_TABLES.length !== RESTORE_ORDER.length) throw new Error('DR safety stop: backup and restore model counts differ')

  const key = getEncryptionKey()
  if (input.security?.encryptedSecretRows && !key) throw new Error('BACKUP_ENCRYPTION_KEY is required to restore encrypted secrets')

  if (dryRun) {
    return {
      target: 'recovery' as const,
      dryRun: true,
      models: RESTORE_ORDER.length,
      wouldInsert: RESTORE_ORDER.reduce((n, table) => n + (Array.isArray(input.tables[table]?.rows) ? input.tables[table].rows.length : 0), 0),
    }
  }

  const db = getRecoveryClient()
  await db.$queryRawUnsafe('SELECT 1')
  const stats = { target: 'recovery' as const, dryRun: false, models: 0, inserted: 0, skipped: 0 }

  for (const table of RESTORE_ORDER) {
    const block = input.tables[table]
    if (!block || !Array.isArray(block.rows)) continue
    stats.models++
    const secretMap = new Map<string, Record<string, string>>()
    for (const item of block.encryptedSecrets ?? []) secretMap.set(String(item.id), item.fields ?? {})

    for (const rawRow of block.rows) {
      const row: Record<string, unknown> = { ...rawRow }
      const encrypted = secretMap.get(String(row.id))
      if (encrypted) for (const [column, payload] of Object.entries(encrypted)) row[column] = decryptSecret(payload)
      const columns = Object.keys(row)
      if (!columns.length) continue
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ')
      const quotedColumns = columns.map(c => `"${c.replace(/"/g, '""')}"`).join(', ')
      const values = columns.map(c => row[c])
      try {
        await db.$executeRawUnsafe(
          `INSERT INTO "${table}" (${quotedColumns}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
          ...values,
        )
        stats.inserted++
      } catch {
        stats.skipped++
      }
    }
  }

  return stats
}
