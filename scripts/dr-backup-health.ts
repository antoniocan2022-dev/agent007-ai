import { PrismaClient } from '@prisma/client'
import { createBackupV2FromClient, inspectBackupV2 } from '../src/lib/backup-v2'

const productionUrl = process.env.AGENT007_PRODUCTION_DATABASE_URL
const encryptionKey = process.env.BACKUP_ENCRYPTION_KEY?.trim()
if (!productionUrl) throw new Error('AGENT007_PRODUCTION_DATABASE_URL is required')
if (!encryptionKey) throw new Error('BACKUP_ENCRYPTION_KEY is required')

const client = new PrismaClient({ datasources: { db: { url: productionUrl } } })

async function main() {
  await client.$queryRaw`SELECT 1`
  const backup = await createBackupV2FromClient(client)
  const inspection = await inspectBackupV2(backup)
  if (!inspection.valid) throw new Error(`Backup validation failed: ${inspection.errors.join('; ')}`)
  if (backup.totals.models !== 38) throw new Error(`Expected 38 models, found ${backup.totals.models}`)
  if (backup.schema?.expectedModels !== 38 || backup.schema?.exportedModels !== 38) throw new Error('Backup schema/model count validation failed')
  if (!backup.integrity?.checksum) throw new Error('Backup checksum is missing')

  console.log(JSON.stringify({
    ok: true,
    backupVersion: backup.backupVersion,
    generatedAt: backup.generatedAt,
    checksum: backup.integrity.checksum,
    schemaFingerprint: backup.schema.fingerprint,
    models: backup.totals.models,
    records: backup.totals.records,
    encryptedSecretRows: backup.security.encryptedSecretRows,
    historicalSecretRedactions: backup.security.historicalSecretRedactions,
    durationMs: backup.durationMs,
    note: 'Backup generated and cryptographically validated in memory; payload intentionally not persisted by this public-repository workflow.'
  }, null, 2))
}

main().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => { await client.$disconnect() })
