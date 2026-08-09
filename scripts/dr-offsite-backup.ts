import { PrismaClient } from '@prisma/client'
import { createBackupV2FromClient, inspectBackupV2 } from '../src/lib/backup-v2'
import { createHash } from 'node:crypto'
import { createGzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'

const productionUrl = process.env.AGENT007_PRODUCTION_DATABASE_URL
const encryptionKey = process.env.BACKUP_ENCRYPTION_KEY?.trim()
const output = process.env.DR_BACKUP_OUTPUT ?? '/tmp/agent007-backup-v2.json.gz'
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

  await mkdir(output.substring(0, output.lastIndexOf('/')) || '.', { recursive: true })
  const json = Buffer.from(JSON.stringify(backup), 'utf8')
  await pipeline(async function* () { yield json }(), createGzip({ level: 9 }), createWriteStream(output))

  const hash = createHash('sha256')
  const fs = await import('node:fs')
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(output)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('end', () => resolve())
    stream.on('error', reject)
  })

  console.log(JSON.stringify({
    ok: true,
    backupVersion: backup.backupVersion,
    generatedAt: backup.generatedAt,
    sourceChecksum: backup.integrity.checksum,
    artifactSha256: hash.digest('hex'),
    models: backup.totals.models,
    records: backup.totals.records,
    encryptedSecretRows: backup.security.encryptedSecretRows,
    historicalSecretRedactions: backup.security.historicalSecretRedactions,
    output,
  }, null, 2))
}

main().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => { await client.$disconnect() })
