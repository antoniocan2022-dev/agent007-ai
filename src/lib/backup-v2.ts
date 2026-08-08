import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { db, ensureDbReady } from '@/lib/db'

export const BACKUP_V2_VERSION = '2.1'

/** All Prisma models currently present in prisma/schema.prisma. */
export const BACKUP_TABLES = [
  'ApiKey', 'AuditLog', 'BankAccount', 'BusinessStrategy', 'ComplianceCheck',
  'ContractDraft', 'Conversation', 'CustomSubagent', 'Customer', 'IncomeEntry',
  'IncomingCommand', 'KnowledgeChunk', 'KnowledgeDoc', 'MLModel', 'MarketingCampaign',
  'Memory', 'Message', 'MissionTracker', 'NotificationLog', 'Opportunity', 'Partnership',
  'PayPalAccount', 'PendingManageAction', 'PhoneConfig', 'Prediction', 'RiskRegister',
  'Schedule', 'ServicePackage', 'SystemHealth', 'Transaction', 'TwoFactorSecret', 'User',
  'UserSetting', 'Experiment', 'PlatformConnection', 'RiskProfile', 'ScalingPlan', 'SentimentLog',
] as const

type BackupTable = typeof BACKUP_TABLES[number]

/** Secrets are never emitted as plaintext. If BACKUP_ENCRYPTION_KEY is configured,
 * they are placed in an authenticated encrypted envelope so a recovery can restore them. */
const SECRET_COLUMNS: Record<string, string[]> = {
  ApiKey: ['key'],
  BankAccount: ['accountNumber', 'routingNumber'],
  PayPalAccount: ['clientSecret'],
  PhoneConfig: ['callmebotApiKey', 'emailImapPassword'],
  PlatformConnection: ['apiKey', 'apiSecret', 'accessToken'],
  Transaction: ['rawPayload'],
  TwoFactorSecret: ['secret', 'backupCodes'],
  User: ['passwordHash'],
}

function getEncryptionKey(): Buffer | null {
  const raw = process.env.BACKUP_ENCRYPTION_KEY?.trim()
  if (!raw) return null
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex')
  return createHash('sha256').update(raw, 'utf8').digest()
}

function encryptSecret(value: unknown): string {
  const key = getEncryptionKey()
  if (!key) throw new Error('BACKUP_ENCRYPTION_KEY is required to encrypt secret fields')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8')
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv, tag, ciphertext].map(b => b.toString('base64url')).join('.')
}

function decryptSecret(payload: string): unknown {
  const key = getEncryptionKey()
  if (!key) throw new Error('BACKUP_ENCRYPTION_KEY is required to decrypt secret fields')
  const [ivB64, tagB64, dataB64] = payload.split('.')
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Invalid encrypted secret envelope')
  const decipher = createDecipheriv('aes-256-gcm', key, ivB64 ? Buffer.from(ivB64, 'base64url') : Buffer.alloc(0))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64url')),
    decipher.final(),
  ])
  return JSON.parse(plaintext.toString('utf8'))
}

function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[key] = normalize(item)
    return out
  }
  return value
}

/**
 * Historical Agent007 messages, tool arguments, URLs and audit payloads can
 * contain credentials that were previously passed through tools. Those values
 * are not secret columns, so encrypting SECRET_COLUMNS alone cannot protect
 * them. Redact common credential-bearing query parameters, headers, JSON keys,
 * and bearer tokens from all public backup data before it leaves the server.
 */
function redactHistoricalSecrets(value: unknown): { value: unknown; redactions: number } {
  let redactions = 0

  const redactString = (input: string): string => {
    let output = input

    const patterns: RegExp[] = [
      /([?&](?:access_token|api[_-]?key|apikey|client_secret|clientSecret|refresh_token|id_token|auth_token|authorization|password|passwd|secret|token)=)[^&#\s"'<>]+/gi,
      /(\bBearer\s+)[A-Za-z0-9._~+/=-]+/gi,
      /("(?:access_token|api[_-]?key|apikey|client_secret|clientSecret|refresh_token|id_token|auth_token|authorization|password|passwd|secret|token)"\s*:\s*")[^"]+("\s*)/gi,
      /('(?:access_token|api[_-]?key|apikey|client_secret|clientSecret|refresh_token|id_token|auth_token|authorization|password|passwd|secret|token)'\s*:\s*')[^']+('\s*)/gi,
    ]

    for (const pattern of patterns) {
      output = output.replace(pattern, (...args: any[]) => {
        redactions++
        const captures = args.slice(1, -2)
        if (captures.length >= 2) return `${captures[0]}[REDACTED]${captures[1]}`
        return `${captures[0] ?? ''}[REDACTED]`
      })
    }

    return output
  }

  const walk = (input: unknown): unknown => {
    if (typeof input === 'string') return redactString(input)
    if (Array.isArray(input)) return input.map(walk)
    if (input && typeof input === 'object') {
      const out: Record<string, unknown> = {}
      for (const [key, item] of Object.entries(input as Record<string, unknown>)) {
        const lower = key.toLowerCase()
        if (/(access[_-]?token|api[_-]?key|client[_-]?secret|refresh[_-]?token|id[_-]?token|auth[_-]?token|password|passwd|secret|authorization)/i.test(lower)) {
          if (item !== null && item !== undefined && item !== '') redactions++
          out[key] = '[REDACTED]'
        } else {
          out[key] = walk(item)
        }
      }
      return out
    }
    return input
  }

  return { value: walk(value), redactions }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const obj = value as Record<string, unknown>
  return `{${Object.keys(obj).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`
}

function checksum(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')
}

async function getSchemaFingerprint(): Promise<string> {
  const columns = await db.$queryRawUnsafe<Array<{ table_name: string; column_name: string; data_type: string }>>(`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `)
  return checksum(columns)
}

async function readTable(table: BackupTable) {
  // Table names come exclusively from the constant whitelist above; they are not user input.
  const rows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT * FROM "${table}"`)
  const secrets = SECRET_COLUMNS[table] ?? []
  const publicRows: Record<string, unknown>[] = []
  const encryptedSecrets: Array<{ id: string; fields: Record<string, string> }> = []
  let historicalSecretRedactions = 0

  for (const raw of rows) {
    const row = normalize(raw) as Record<string, unknown>
    const clean: Record<string, unknown> = { ...row }
    const encrypted: Record<string, string> = {}
    for (const column of secrets) {
      if (column in clean && clean[column] !== null && clean[column] !== undefined) {
        if (getEncryptionKey()) encrypted[column] = encryptSecret(clean[column])
        delete clean[column]
      }
    }

    const sanitized = redactHistoricalSecrets(clean)
    historicalSecretRedactions += sanitized.redactions
    publicRows.push(sanitized.value as Record<string, unknown>)
    if (Object.keys(encrypted).length) encryptedSecrets.push({ id: String(row.id), fields: encrypted })
  }

  return { rows: publicRows, encryptedSecrets, count: rows.length, historicalSecretRedactions }
}

export async function createBackupV2() {
  await ensureDbReady().catch(() => {})
  const startedAt = Date.now()
  const tables: Record<string, { rows: Record<string, unknown>[]; encryptedSecrets: Array<{ id: string; fields: Record<string, string> }>; count: number; historicalSecretRedactions: number }> = {}
  let totalRecords = 0
  let totalHistoricalSecretRedactions = 0

  for (const table of BACKUP_TABLES) {
    const result = await readTable(table)
    tables[table] = result
    totalRecords += result.count
    totalHistoricalSecretRedactions += result.historicalSecretRedactions
  }

  const schemaFingerprint = await getSchemaFingerprint()
  const payload = {
    backupVersion: BACKUP_V2_VERSION,
    application: 'Agent007 AI',
    generatedAt: new Date().toISOString(),
    gitCommit: process.env.VERCEL_GIT_COMMIT_SHA ?? 'unknown',
    gitBranch: process.env.VERCEL_GIT_COMMIT_REF ?? 'unknown',
    environment: process.env.VERCEL_ENV ?? 'production',
    schema: {
      fingerprint: schemaFingerprint,
      expectedModels: BACKUP_TABLES.length,
      exportedModels: Object.keys(tables).length,
    },
    security: {
      secretPolicy: getEncryptionKey() ? 'AES-256-GCM encrypted; historical credential-like values redacted' : 'secret fields omitted; configure BACKUP_ENCRYPTION_KEY for complete credential recovery; historical credential-like values redacted',
      encryptedSecretRows: Object.values(tables).reduce((n, t) => n + t.encryptedSecrets.length, 0),
      historicalSecretRedactions: totalHistoricalSecretRedactions,
    },
    totals: { models: Object.keys(tables).length, records: totalRecords },
    tables,
    durationMs: Date.now() - startedAt,
  }

  const integrity = checksum(payload)
  return { ...payload, integrity: { algorithm: 'SHA-256', checksum: integrity } }
}

export async function inspectBackupV2(input: any) {
  if (!input || (input.backupVersion !== '2.0' && input.backupVersion !== BACKUP_V2_VERSION) || !input.tables) {
    return { valid: false, errors: ['Unsupported or malformed Backup V2 payload'] }
  }
  const errors: string[] = []
  const missing = BACKUP_TABLES.filter(table => !input.tables[table])
  if (missing.length) errors.push(`Missing model exports: ${missing.join(', ')}`)
  if (input.schema?.expectedModels !== BACKUP_TABLES.length) errors.push('Model-count mismatch')
  if (input.integrity?.checksum) {
    const copy = { ...input }
    delete copy.integrity
    if (checksum(copy) !== input.integrity.checksum) errors.push('Integrity checksum mismatch')
  } else {
    errors.push('Missing integrity checksum')
  }
  return {
    valid: errors.length === 0,
    errors,
    models: Object.keys(input.tables ?? {}).length,
    records: Object.values(input.tables ?? {}).reduce((n: number, t: any) => n + Number(t?.count ?? 0), 0),
  }
}

/** Additive restore: inserts records by primary key and never deletes production data. */
export async function restoreBackupV2(input: any, dryRun = true) {
  const inspection = await inspectBackupV2(input)
  if (!inspection.valid) throw new Error(`Backup validation failed: ${inspection.errors.join('; ')}`)
  const key = getEncryptionKey()
  if (input.security?.encryptedSecretRows && !key) throw new Error('BACKUP_ENCRYPTION_KEY is required to restore encrypted secrets')

  const order: BackupTable[] = [
    'User', 'UserSetting', 'ApiKey', 'BankAccount', 'BusinessStrategy', 'ComplianceCheck',
    'ContractDraft', 'Customer', 'IncomeEntry', 'IncomingCommand', 'KnowledgeDoc', 'KnowledgeChunk',
    'MLModel', 'MarketingCampaign', 'Memory', 'Opportunity', 'Partnership', 'PayPalAccount',
    'PendingManageAction', 'PhoneConfig', 'Prediction', 'RiskProfile', 'RiskRegister', 'ScalingPlan',
    'ServicePackage', 'SystemHealth', 'Transaction', 'TwoFactorSecret', 'Experiment',
    'PlatformConnection', 'MissionTracker', 'SentimentLog', 'Schedule', 'CustomSubagent',
    'Conversation', 'Message', 'NotificationLog',
  ]

  const stats = { wouldInsert: 0, inserted: 0, skipped: 0, models: 0 }
  if (dryRun) {
    for (const table of order) {
      const block = input.tables[table]
      if (!block) continue
      stats.models++
      stats.wouldInsert += Array.isArray(block.rows) ? block.rows.length : 0
    }
    return { dryRun: true, ...stats }
  }

  for (const table of order) {
    const block = input.tables[table]
    if (!block || !Array.isArray(block.rows)) continue
    stats.models++
    const secretMap = new Map<string, Record<string, string>>()
    for (const item of block.encryptedSecrets ?? []) secretMap.set(String(item.id), item.fields ?? {})

    for (const rawRow of block.rows) {
      const row: Record<string, unknown> = { ...rawRow }
      const encrypted = secretMap.get(String(row.id))
      if (encrypted) {
        for (const [column, payload] of Object.entries(encrypted)) row[column] = decryptSecret(payload)
      }
      const columns = Object.keys(row)
      if (!columns.length) continue
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ')
      const quotedColumns = columns.map(c => `"${c.replace(/"/g, '""')}"`).join(', ')
      const values = columns.map(c => row[c] instanceof Date ? row[c] : row[c])
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

  return { dryRun: false, ...stats }
}
