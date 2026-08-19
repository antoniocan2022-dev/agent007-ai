import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const statements = [
  'ALTER TABLE "PhoneConfig" ADD COLUMN IF NOT EXISTS "emailImapHost" TEXT',
  'ALTER TABLE "PhoneConfig" ADD COLUMN IF NOT EXISTS "emailImapPort" TEXT',
  'ALTER TABLE "PhoneConfig" ADD COLUMN IF NOT EXISTS "emailImapUser" TEXT',
  'ALTER TABLE "PhoneConfig" ADD COLUMN IF NOT EXISTS "emailImapPassword" TEXT',
  'ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "source" TEXT',
  'ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "url" TEXT',
  'ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "riskScore" INTEGER',
  'ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "estIncome" DOUBLE PRECISION',
  `CREATE TABLE IF NOT EXISTS "ExecutionReceipt" (
    "id" TEXT PRIMARY KEY,
    "missionId" TEXT NOT NULL,
    "userId" TEXT,
    "actorId" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT,
    "inputReference" TEXT,
    "outputReference" TEXT,
    "errorCode" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordHash" TEXT NOT NULL,
    "metadata" TEXT
  )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS "ExecutionReceipt_missionId_idempotencyKey_key" ON "ExecutionReceipt" ("missionId", "idempotencyKey")',
  'CREATE INDEX IF NOT EXISTS "ExecutionReceipt_missionId_createdAt_idx" ON "ExecutionReceipt" ("missionId", "createdAt")',
  'CREATE INDEX IF NOT EXISTS "ExecutionReceipt_actorId_createdAt_idx" ON "ExecutionReceipt" ("actorId", "createdAt")',
  'CREATE INDEX IF NOT EXISTS "ExecutionReceipt_status_createdAt_idx" ON "ExecutionReceipt" ("status", "createdAt")',
  `CREATE TABLE IF NOT EXISTS "EvidenceLedger" (
    "id" TEXT PRIMARY KEY,
    "missionId" TEXT NOT NULL,
    "userId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "previousHash" TEXT,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS "EvidenceLedger_missionId_idempotencyKey_key" ON "EvidenceLedger" ("missionId", "idempotencyKey")',
  'CREATE UNIQUE INDEX IF NOT EXISTS "EvidenceLedger_missionId_version_key" ON "EvidenceLedger" ("missionId", "version")',
  'CREATE INDEX IF NOT EXISTS "EvidenceLedger_missionId_createdAt_idx" ON "EvidenceLedger" ("missionId", "createdAt")',
  'CREATE INDEX IF NOT EXISTS "EvidenceLedger_status_createdAt_idx" ON "EvidenceLedger" ("status", "createdAt")',
  `CREATE TABLE IF NOT EXISTS "EvidenceSource" (
    "id" TEXT PRIMARY KEY,
    "ledgerId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "retrievedAt" TIMESTAMP(3) NOT NULL,
    "rawEvidenceRef" TEXT NOT NULL,
    "rawEvidenceHash" TEXT NOT NULL,
    "requestHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  'CREATE INDEX IF NOT EXISTS "EvidenceSource_ledgerId_retrievedAt_idx" ON "EvidenceSource" ("ledgerId", "retrievedAt")',
  'CREATE INDEX IF NOT EXISTS "EvidenceSource_provider_retrievedAt_idx" ON "EvidenceSource" ("provider", "retrievedAt")',
  'CREATE UNIQUE INDEX IF NOT EXISTS "EvidenceSource_ledgerId_sourceUrl_rawEvidenceHash_key" ON "EvidenceSource" ("ledgerId", "sourceUrl", "rawEvidenceHash")',
  `CREATE TABLE IF NOT EXISTS "EvidenceClaim" (
    "id" TEXT PRIMARY KEY,
    "ledgerId" TEXT NOT NULL,
    "sourceId" TEXT,
    "claimKey" TEXT NOT NULL,
    "claimText" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "verificationStatus" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS "EvidenceClaim_ledgerId_claimKey_key" ON "EvidenceClaim" ("ledgerId", "claimKey")',
  'CREATE INDEX IF NOT EXISTS "EvidenceClaim_ledgerId_verificationStatus_idx" ON "EvidenceClaim" ("ledgerId", "verificationStatus")',
  'CREATE INDEX IF NOT EXISTS "EvidenceClaim_sourceId_idx" ON "EvidenceClaim" ("sourceId")',
  'ALTER TABLE "EvidenceSource" ADD CONSTRAINT "EvidenceSource_ledgerId_fkey" FOREIGN KEY ("ledgerId") REFERENCES "EvidenceLedger"("id") ON DELETE CASCADE ON UPDATE CASCADE',
  'ALTER TABLE "EvidenceClaim" ADD CONSTRAINT "EvidenceClaim_ledgerId_fkey" FOREIGN KEY ("ledgerId") REFERENCES "EvidenceLedger"("id") ON DELETE CASCADE ON UPDATE CASCADE',
  'ALTER TABLE "EvidenceClaim" ADD CONSTRAINT "EvidenceClaim_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "EvidenceSource"("id") ON DELETE SET NULL ON UPDATE CASCADE',
]

async function main() {
  for (const statement of statements) {
    try {
      await prisma.$executeRawUnsafe(statement)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/already exists/i.test(message)) continue
      // PostgreSQL raises a duplicate-object error for an FK that was already
      // reconciled. Treat only that exact idempotent case as success.
      if (/constraint .* already exists/i.test(message)) continue
      throw error
    }
  }

  const required = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('PhoneConfig','Opportunity','ExecutionReceipt','EvidenceLedger','EvidenceSource','EvidenceClaim')
  `

  const requiredSet = new Set(required.map(row => row.table_name))
  const missingTables = ['PhoneConfig','Opportunity','ExecutionReceipt','EvidenceLedger','EvidenceSource','EvidenceClaim'].filter(name => !requiredSet.has(name))
  if (missingTables.length) throw new Error(`Schema reconciliation incomplete. Missing tables: ${missingTables.join(', ')}`)

  const executionIndexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN ('ExecutionReceipt_missionId_idempotencyKey_key','EvidenceLedger_missionId_idempotencyKey_key','EvidenceLedger_missionId_version_key','EvidenceClaim_ledgerId_claimKey_key')
  `
  if (executionIndexes.length !== 4) throw new Error(`Proof schema indexes incomplete: ${executionIndexes.length}/4`)

  console.log('Production schema reconciliation verified: legacy additive columns plus proof ledger tables/indexes present.')
}

main()
  .catch((error) => {
    console.error('Production schema reconciliation failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
