import { PrismaClient } from '@prisma/client'
import { createBackupV2FromClient, inspectBackupV2, restoreBackupV2 } from '../src/lib/backup-v2'

const confirmation = process.env.DR_RESTORE_CONFIRMATION
const mode = process.env.DR_RESTORE_MODE ?? 'dry-run'
const productionUrl = process.env.AGENT007_PRODUCTION_DATABASE_URL
const recoveryUrl = process.env.AGENT007_DR_DATABASE_URL

if (confirmation !== 'RESTORE_AGENT007_DR') throw new Error('Missing explicit DR_RESTORE_CONFIRMATION=RESTORE_AGENT007_DR')
if (!productionUrl || !recoveryUrl) throw new Error('Both AGENT007_PRODUCTION_DATABASE_URL and AGENT007_DR_DATABASE_URL are required')
if (productionUrl === recoveryUrl) throw new Error('SAFETY STOP: recovery URL equals production URL')

const prod = new PrismaClient({ datasources: { db: { url: productionUrl } } })
const dr = new PrismaClient({ datasources: { db: { url: recoveryUrl } } })

function hostOf(url: string) {
  try { return new URL(url).hostname } catch { return '' }
}

async function schemaFingerprint(client: PrismaClient) {
  const rows = await client.$queryRaw<Array<{ table_name: string; column_name: string; data_type: string; ordinal_position: number }>>`
    SELECT table_name, column_name, data_type, ordinal_position
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `
  const canonical = JSON.stringify(rows)
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}

async function main() {
  const productionHost = hostOf(productionUrl!)
  const recoveryHost = hostOf(recoveryUrl!)
  if (!productionHost || !recoveryHost || productionHost === recoveryHost) {
    throw new Error('SAFETY STOP: production and recovery database hosts could not be positively distinguished')
  }

  await prod.$queryRaw`SELECT 1`
  await dr.$queryRaw`SELECT 1`

  const backup = await createBackupV2FromClient(prod)
  const inspection = await inspectBackupV2(backup)
  if (!inspection.valid) throw new Error(`Backup validation failed: ${inspection.errors.join('; ')}`)

  const sourceSchemaFingerprint = String(backup.schema?.fingerprint ?? '')
  const recoverySchemaFingerprint = await schemaFingerprint(dr)
  console.log(JSON.stringify({
    preflight: {
      sourceSchemaFingerprint,
      recoverySchemaFingerprint,
      schemaMatch: sourceSchemaFingerprint === recoverySchemaFingerprint,
    },
  }, null, 2))

  if (sourceSchemaFingerprint !== recoverySchemaFingerprint) {
    throw new Error(`DR schema mismatch: source=${sourceSchemaFingerprint} recovery=${recoverySchemaFingerprint}. Run DR schema bootstrap before restore.`)
  }

  const dryRun = mode !== 'restore'
  const result = await restoreBackupV2(backup, dryRun, dr)

  const verification: Record<string, number> = {}
  for (const table of Object.keys(backup.tables)) {
    const rows = await dr.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT COUNT(*)::bigint AS count FROM "${table.replace(/"/g, '""')}"`)
    verification[table] = Number(rows[0]?.count ?? 0)
  }

  const sourceCounts: Record<string, number> = {}
  for (const [table, block] of Object.entries(backup.tables as Record<string, any>)) sourceCounts[table] = Number(block.count ?? 0)

  const mismatches = Object.keys(sourceCounts).filter(table => {
    if (dryRun) return false
    return verification[table] < sourceCounts[table]
  })

  console.log(JSON.stringify({
    ok: mismatches.length === 0,
    mode: dryRun ? 'dry-run' : 'restore',
    backupVersion: backup.backupVersion,
    checksum: backup.integrity.checksum,
    source: { host: productionHost, models: backup.totals.models, records: backup.totals.records },
    recovery: { host: recoveryHost, models: Object.keys(verification).length, records: Object.values(verification).reduce((a, b) => a + b, 0) },
    result,
    mismatches,
  }, null, 2))

  if (mismatches.length) throw new Error(`Recovery verification failed for ${mismatches.length} model(s): ${mismatches.join(', ')}`)
}

main().catch(async error => {
  console.error(error)
  process.exitCode = 1
}).finally(async () => {
  await Promise.allSettled([prod.$disconnect(), dr.$disconnect()])
})
