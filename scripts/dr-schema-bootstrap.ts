import { spawnSync } from 'node:child_process'
import { PrismaClient } from '@prisma/client'

const enabled = process.env.DR_SCHEMA_BOOTSTRAP === 'true'

if (!enabled) {
  console.log('[DR bootstrap] Disabled. No schema mutation performed.')
  process.exit(0)
}

const recoveryUrl = process.env.AGENT007_DR_DATABASE_URL?.trim()
const productionUrl = process.env.DATABASE_URL?.trim()

if (!recoveryUrl) {
  throw new Error('[DR bootstrap] AGENT007_DR_DATABASE_URL is required when bootstrap is enabled.')
}

if (!/^postgres(ql)?:\/\//i.test(recoveryUrl)) {
  throw new Error('[DR bootstrap] Recovery URL must be PostgreSQL.')
}

if (productionUrl && recoveryUrl === productionUrl) {
  throw new Error('[DR bootstrap] REFUSED: recovery database URL equals production DATABASE_URL.')
}

const markerKey = 'dr_schema_bootstrap_v1'

async function main() {
  // The Memory table is part of the expected 38-model schema. If it exists and
  // contains the marker, the bootstrap has already completed and is idempotent.
  const probe = new PrismaClient({ datasources: { db: { url: recoveryUrl } } })
  let alreadyBootstrapped = false
  try {
    const rows = await probe.$queryRawUnsafe<Array<{ key: string }>>(
      'SELECT "key" FROM "Memory" WHERE "key" = $1 LIMIT 1',
      markerKey,
    )
    alreadyBootstrapped = rows.length > 0
  } catch {
    // Expected on an empty recovery database: the Memory table does not exist yet.
  } finally {
    await probe.$disconnect()
  }

  if (alreadyBootstrapped) {
    console.log('[DR bootstrap] Recovery schema already initialized. No mutation performed.')
    return
  }

  console.log('[DR bootstrap] Initializing the isolated recovery schema...')

  const result = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['prisma', 'db', 'push', '--accept-data-loss=false'],
    {
      env: { ...process.env, DATABASE_URL: recoveryUrl },
      stdio: 'inherit',
    },
  )

  if (result.status !== 0) {
    throw new Error(`[DR bootstrap] Prisma schema push failed with exit code ${result.status ?? 'unknown'}.`)
  }

  const verify = new PrismaClient({ datasources: { db: { url: recoveryUrl } } })
  try {
    const expected = [
      'ApiKey','AuditLog','BankAccount','BusinessStrategy','ComplianceCheck','ContractDraft',
      'Conversation','CustomSubagent','Customer','IncomeEntry','IncomingCommand','KnowledgeChunk',
      'KnowledgeDoc','MLModel','MarketingCampaign','Memory','Message','MissionTracker','NotificationLog',
      'Opportunity','Partnership','PayPalAccount','PendingManageAction','PhoneConfig','Prediction',
      'RiskRegister','Schedule','ServicePackage','SystemHealth','Transaction','TwoFactorSecret','User',
      'UserSetting','Experiment','PlatformConnection','RiskProfile','ScalingPlan','SentimentLog',
    ]

    const rows = await verify.$queryRawUnsafe<Array<{ table_name: string }>>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    )
    const actual = new Set(rows.map((r) => r.table_name))
    const missing = expected.filter((name) => !actual.has(name))
    if (missing.length) {
      throw new Error(`[DR bootstrap] Schema verification failed. Missing tables: ${missing.join(', ')}`)
    }

    await verify.memory.upsert({
      where: { key: markerKey },
      create: { key: markerKey, value: new Date().toISOString(), category: 'system' },
      update: { value: new Date().toISOString() },
    })

    console.log(`[DR bootstrap] SUCCESS: verified ${expected.length}/${expected.length} expected models.`)
  } finally {
    await verify.$disconnect()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
