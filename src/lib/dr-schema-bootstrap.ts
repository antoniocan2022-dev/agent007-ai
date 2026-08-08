import { PrismaClient } from '@prisma/client'

const EXPECTED_TABLES = [
  'ApiKey', 'AuditLog', 'BankAccount', 'BusinessStrategy', 'ComplianceCheck',
  'ContractDraft', 'Conversation', 'CustomSubagent', 'Customer', 'IncomeEntry',
  'IncomingCommand', 'KnowledgeChunk', 'KnowledgeDoc', 'MLModel', 'MarketingCampaign',
  'Memory', 'Message', 'MissionTracker', 'NotificationLog', 'Opportunity', 'Partnership',
  'PayPalAccount', 'PendingManageAction', 'PhoneConfig', 'Prediction', 'RiskRegister',
  'Schedule', 'ServicePackage', 'SystemHealth', 'Transaction', 'TwoFactorSecret', 'User',
  'UserSetting', 'Experiment', 'PlatformConnection', 'RiskProfile', 'ScalingPlan', 'SentimentLog',
] as const

function getRecoveryUrl(): string {
  const recovery = process.env.AGENT007_DR_DATABASE_URL?.trim()
  if (!recovery) throw new Error('AGENT007_DR_DATABASE_URL is not configured')
  if (!/^postgres(?:ql)?:\/\//i.test(recovery)) throw new Error('AGENT007_DR_DATABASE_URL must be a PostgreSQL URL')
  const production = process.env.DATABASE_URL?.trim()
  if (production && recovery === production) throw new Error('DR safety stop: recovery database URL matches production DATABASE_URL')
  return recovery
}

function getClient(): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: getRecoveryUrl() } } })
}

async function existingTables(db: PrismaClient): Promise<string[]> {
  const rows = await db.$queryRawUnsafe<Array<{ table_name: string }>>(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `)
  return rows.map(r => r.table_name)
}

export async function inspectRecoverySchema() {
  const db = getClient()
  try {
    await db.$queryRawUnsafe('SELECT 1')
    const tables = await existingTables(db)
    const missing = EXPECTED_TABLES.filter(t => !tables.includes(t))
    return {
      connected: true,
      ready: missing.length === 0,
      expectedTables: EXPECTED_TABLES.length,
      existingTables: tables.length,
      missingTables: missing,
    }
  } finally {
    await db.$disconnect().catch(() => {})
  }
}

/**
 * Intentionally does not mutate the database. Schema creation remains an
 * explicit deployment operation so a normal health check can never alter DR.
 */
export async function assertRecoverySchemaReady() {
  const state = await inspectRecoverySchema()
  if (!state.ready) {
    throw new Error(`Recovery schema is not initialized; missing ${state.missingTables.length} expected tables`)
  }
  return state
}
