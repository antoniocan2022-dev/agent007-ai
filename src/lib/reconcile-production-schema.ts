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
  `CREATE TABLE IF NOT EXISTS "ExecutionReceipt" ("id" TEXT PRIMARY KEY,"missionId" TEXT NOT NULL,"userId" TEXT,"actorId" TEXT NOT NULL,"actorType" TEXT NOT NULL,"action" TEXT NOT NULL,"status" TEXT NOT NULL,"idempotencyKey" TEXT NOT NULL,"requestHash" TEXT,"inputReference" TEXT,"outputReference" TEXT,"errorCode" TEXT,"startedAt" TIMESTAMP(3) NOT NULL,"completedAt" TIMESTAMP(3),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"recordHash" TEXT NOT NULL,"metadata" TEXT)`,
  'CREATE UNIQUE INDEX IF NOT EXISTS "ExecutionReceipt_missionId_idempotencyKey_key" ON "ExecutionReceipt" ("missionId", "idempotencyKey")',
  'CREATE INDEX IF NOT EXISTS "ExecutionReceipt_missionId_createdAt_idx" ON "ExecutionReceipt" ("missionId", "createdAt")',
  'CREATE INDEX IF NOT EXISTS "ExecutionReceipt_actorId_createdAt_idx" ON "ExecutionReceipt" ("actorId", "createdAt")',
  'CREATE INDEX IF NOT EXISTS "ExecutionReceipt_status_createdAt_idx" ON "ExecutionReceipt" ("status", "createdAt")',
  `CREATE TABLE IF NOT EXISTS "EvidenceLedger" ("id" TEXT PRIMARY KEY,"missionId" TEXT NOT NULL,"userId" TEXT,"idempotencyKey" TEXT NOT NULL,"version" INTEGER NOT NULL,"title" TEXT NOT NULL,"status" TEXT NOT NULL DEFAULT 'draft',"previousHash" TEXT,"contentHash" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  'CREATE UNIQUE INDEX IF NOT EXISTS "EvidenceLedger_missionId_idempotencyKey_key" ON "EvidenceLedger" ("missionId", "idempotencyKey")',
  'CREATE UNIQUE INDEX IF NOT EXISTS "EvidenceLedger_missionId_version_key" ON "EvidenceLedger" ("missionId", "version")',
  'CREATE INDEX IF NOT EXISTS "EvidenceLedger_missionId_createdAt_idx" ON "EvidenceLedger" ("missionId", "createdAt")',
  'CREATE INDEX IF NOT EXISTS "EvidenceLedger_status_createdAt_idx" ON "EvidenceLedger" ("status", "createdAt")',
  `CREATE TABLE IF NOT EXISTS "EvidenceSource" ("id" TEXT PRIMARY KEY,"ledgerId" TEXT NOT NULL,"provider" TEXT NOT NULL,"sourceUrl" TEXT NOT NULL,"retrievedAt" TIMESTAMP(3) NOT NULL,"rawEvidenceRef" TEXT NOT NULL,"rawEvidenceHash" TEXT NOT NULL,"requestHash" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  'CREATE INDEX IF NOT EXISTS "EvidenceSource_ledgerId_retrievedAt_idx" ON "EvidenceSource" ("ledgerId", "retrievedAt")',
  'CREATE INDEX IF NOT EXISTS "EvidenceSource_provider_retrievedAt_idx" ON "EvidenceSource" ("provider", "retrievedAt")',
  'CREATE UNIQUE INDEX IF NOT EXISTS "EvidenceSource_ledgerId_sourceUrl_rawEvidenceHash_key" ON "EvidenceSource" ("ledgerId", "sourceUrl", "rawEvidenceHash")',
  `CREATE TABLE IF NOT EXISTS "EvidenceClaim" ("id" TEXT PRIMARY KEY,"ledgerId" TEXT NOT NULL,"sourceId" TEXT,"claimKey" TEXT NOT NULL,"claimText" TEXT NOT NULL,"classification" TEXT NOT NULL,"confidence" DOUBLE PRECISION NOT NULL,"verificationStatus" TEXT NOT NULL,"notes" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  'CREATE UNIQUE INDEX IF NOT EXISTS "EvidenceClaim_ledgerId_claimKey_key" ON "EvidenceClaim" ("ledgerId", "claimKey")',
  'CREATE INDEX IF NOT EXISTS "EvidenceClaim_ledgerId_verificationStatus_idx" ON "EvidenceClaim" ("ledgerId", "verificationStatus")',
  'CREATE INDEX IF NOT EXISTS "EvidenceClaim_sourceId_idx" ON "EvidenceClaim" ("sourceId")',
  'ALTER TABLE "EvidenceSource" ADD CONSTRAINT "EvidenceSource_ledgerId_fkey" FOREIGN KEY ("ledgerId") REFERENCES "EvidenceLedger"("id") ON DELETE CASCADE ON UPDATE CASCADE',
  'ALTER TABLE "EvidenceClaim" ADD CONSTRAINT "EvidenceClaim_ledgerId_fkey" FOREIGN KEY ("ledgerId") REFERENCES "EvidenceLedger"("id") ON DELETE CASCADE ON UPDATE CASCADE',
  'ALTER TABLE "EvidenceClaim" ADD CONSTRAINT "EvidenceClaim_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "EvidenceSource"("id") ON DELETE SET NULL ON UPDATE CASCADE',
  `CREATE TABLE IF NOT EXISTS "BusinessUnit" ("id" TEXT PRIMARY KEY,"ownerUserId" TEXT NOT NULL,"businessKey" TEXT NOT NULL,"name" TEXT NOT NULL,"description" TEXT NOT NULL DEFAULT '',"status" TEXT NOT NULL DEFAULT 'ACTIVE',"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  'ALTER TABLE "BusinessUnit" DROP CONSTRAINT IF EXISTS "BusinessUnit_businessKey_key"',
  'CREATE UNIQUE INDEX IF NOT EXISTS "BusinessUnit_ownerUserId_businessKey_key" ON "BusinessUnit" ("ownerUserId", "businessKey")',
  'CREATE INDEX IF NOT EXISTS "BusinessUnit_ownerUserId_idx" ON "BusinessUnit" ("ownerUserId")',
  'CREATE INDEX IF NOT EXISTS "BusinessUnit_status_idx" ON "BusinessUnit" ("status")',
  'ALTER TABLE "BusinessUnit" ADD CONSTRAINT "BusinessUnit_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE',
  `CREATE TABLE IF NOT EXISTS "Venture" ("id" TEXT PRIMARY KEY,"ventureKey" TEXT NOT NULL UNIQUE,"businessUnitId" TEXT,"ownerUserId" TEXT NOT NULL,"name" TEXT NOT NULL,"type" TEXT NOT NULL,"description" TEXT NOT NULL,"targetMarket" TEXT NOT NULL,"pricingModel" TEXT NOT NULL,"status" TEXT NOT NULL DEFAULT 'PROPOSED',"productionState" TEXT NOT NULL DEFAULT 'STRUCTURAL_ONLY',"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  'CREATE INDEX IF NOT EXISTS "Venture_businessUnitId_idx" ON "Venture" ("businessUnitId")',
  'CREATE INDEX IF NOT EXISTS "Venture_ownerUserId_idx" ON "Venture" ("ownerUserId")',
  'CREATE INDEX IF NOT EXISTS "Venture_status_idx" ON "Venture" ("status")',
  'ALTER TABLE "Venture" ADD CONSTRAINT "Venture_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "BusinessUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE',
  'ALTER TABLE "Venture" ADD CONSTRAINT "Venture_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE',
  'ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "ventureId" TEXT',
  'ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "ventureId" TEXT',
  'ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "ventureId" TEXT',
  'ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "customerId" TEXT',
  'ALTER TABLE "MarketingCampaign" ADD COLUMN IF NOT EXISTS "ventureId" TEXT',
  'ALTER TABLE "IncomeEntry" ADD COLUMN IF NOT EXISTS "ventureId" TEXT',
  'CREATE INDEX IF NOT EXISTS "Customer_ventureId_idx" ON "Customer" ("ventureId")',
  'CREATE INDEX IF NOT EXISTS "Opportunity_ventureId_idx" ON "Opportunity" ("ventureId")',
  'CREATE INDEX IF NOT EXISTS "Transaction_ventureId_idx" ON "Transaction" ("ventureId")',
  'CREATE INDEX IF NOT EXISTS "Transaction_customerId_idx" ON "Transaction" ("customerId")',
  'CREATE INDEX IF NOT EXISTS "MarketingCampaign_ventureId_idx" ON "MarketingCampaign" ("ventureId")',
  'CREATE INDEX IF NOT EXISTS "IncomeEntry_ventureId_idx" ON "IncomeEntry" ("ventureId")',
  'ALTER TABLE "Customer" ADD CONSTRAINT "Customer_ventureId_fkey" FOREIGN KEY ("ventureId") REFERENCES "Venture"("id") ON DELETE SET NULL ON UPDATE CASCADE',
  'ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_ventureId_fkey" FOREIGN KEY ("ventureId") REFERENCES "Venture"("id") ON DELETE SET NULL ON UPDATE CASCADE',
  'ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_ventureId_fkey" FOREIGN KEY ("ventureId") REFERENCES "Venture"("id") ON DELETE SET NULL ON UPDATE CASCADE',
  'ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE',
  'ALTER TABLE "MarketingCampaign" ADD CONSTRAINT "MarketingCampaign_ventureId_fkey" FOREIGN KEY ("ventureId") REFERENCES "Venture"("id") ON DELETE SET NULL ON UPDATE CASCADE',
  'ALTER TABLE "IncomeEntry" ADD CONSTRAINT "IncomeEntry_ventureId_fkey" FOREIGN KEY ("ventureId") REFERENCES "Venture"("id") ON DELETE SET NULL ON UPDATE CASCADE',
  `CREATE TABLE IF NOT EXISTS "Subscription" ("id" TEXT PRIMARY KEY,"ventureId" TEXT NOT NULL,"customerId" TEXT NOT NULL,"provider" TEXT NOT NULL,"providerSubscriptionId" TEXT,"status" TEXT NOT NULL DEFAULT 'active',"plan" TEXT NOT NULL,"amount" DOUBLE PRECISION NOT NULL,"currency" TEXT NOT NULL DEFAULT 'USD',"interval" TEXT NOT NULL DEFAULT 'month',"currentPeriodStart" TIMESTAMP(3),"currentPeriodEnd" TIMESTAMP(3),"cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT FALSE,"rawPayload" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  'CREATE UNIQUE INDEX IF NOT EXISTS "Subscription_provider_providerSubscriptionId_key" ON "Subscription" ("provider", "providerSubscriptionId")',
  'CREATE INDEX IF NOT EXISTS "Subscription_ventureId_idx" ON "Subscription" ("ventureId")',
  'CREATE INDEX IF NOT EXISTS "Subscription_customerId_idx" ON "Subscription" ("customerId")',
  'CREATE INDEX IF NOT EXISTS "Subscription_status_idx" ON "Subscription" ("status")',
  'ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_ventureId_fkey" FOREIGN KEY ("ventureId") REFERENCES "Venture"("id") ON DELETE RESTRICT ON UPDATE CASCADE',
  'ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE',
  `CREATE TABLE IF NOT EXISTS "Invoice" ("id" TEXT PRIMARY KEY,"ventureId" TEXT NOT NULL,"customerId" TEXT NOT NULL,"subscriptionId" TEXT,"transactionId" TEXT,"provider" TEXT NOT NULL,"providerInvoiceId" TEXT,"status" TEXT NOT NULL DEFAULT 'open',"amount" DOUBLE PRECISION NOT NULL,"currency" TEXT NOT NULL DEFAULT 'USD',"dueAt" TIMESTAMP(3),"paidAt" TIMESTAMP(3),"rawPayload" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  'CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_provider_providerInvoiceId_key" ON "Invoice" ("provider", "providerInvoiceId")',
  'CREATE INDEX IF NOT EXISTS "Invoice_ventureId_idx" ON "Invoice" ("ventureId")',
  'CREATE INDEX IF NOT EXISTS "Invoice_customerId_idx" ON "Invoice" ("customerId")',
  'CREATE INDEX IF NOT EXISTS "Invoice_subscriptionId_idx" ON "Invoice" ("subscriptionId")',
  'CREATE INDEX IF NOT EXISTS "Invoice_transactionId_idx" ON "Invoice" ("transactionId")',
  'CREATE INDEX IF NOT EXISTS "Invoice_status_idx" ON "Invoice" ("status")',
  'ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_ventureId_fkey" FOREIGN KEY ("ventureId") REFERENCES "Venture"("id") ON DELETE RESTRICT ON UPDATE CASCADE',
  'ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE',
  'ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE',
  'ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE',
  `CREATE TABLE IF NOT EXISTS "CustomerSuccessState" ("id" TEXT PRIMARY KEY,"ventureId" TEXT NOT NULL,"customerId" TEXT NOT NULL,"lifecycle" TEXT NOT NULL DEFAULT 'ONBOARDING',"activationStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',"riskLevel" TEXT NOT NULL DEFAULT 'UNKNOWN',"healthScore" DOUBLE PRECISION,"satisfactionScore" DOUBLE PRECISION,"lastValueAt" TIMESTAMP(3),"renewalAt" TIMESTAMP(3),"nextBestAction" TEXT,"ownerUserId" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  'CREATE UNIQUE INDEX IF NOT EXISTS "CustomerSuccessState_ventureId_customerId_key" ON "CustomerSuccessState" ("ventureId", "customerId")',
  'CREATE INDEX IF NOT EXISTS "CustomerSuccessState_ventureId_idx" ON "CustomerSuccessState" ("ventureId")',
  'CREATE INDEX IF NOT EXISTS "CustomerSuccessState_customerId_idx" ON "CustomerSuccessState" ("customerId")',
  'CREATE INDEX IF NOT EXISTS "CustomerSuccessState_lifecycle_idx" ON "CustomerSuccessState" ("lifecycle")',
  'CREATE INDEX IF NOT EXISTS "CustomerSuccessState_riskLevel_idx" ON "CustomerSuccessState" ("riskLevel")',
  'ALTER TABLE "CustomerSuccessState" ADD CONSTRAINT "CustomerSuccessState_ventureId_fkey" FOREIGN KEY ("ventureId") REFERENCES "Venture"("id") ON DELETE CASCADE ON UPDATE CASCADE',
  'ALTER TABLE "CustomerSuccessState" ADD CONSTRAINT "CustomerSuccessState_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE',
  'ALTER TABLE "CustomerSuccessState" ADD CONSTRAINT "CustomerSuccessState_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE',
]

async function main() {
  for (const statement of statements) {
    try {
      await prisma.$executeRawUnsafe(statement)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/already exists/i.test(message)) continue
      if (/constraint .* already exists/i.test(message)) continue
      throw error
    }
  }
  const required = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name FROM information_schema.tables WHERE table_schema='public'
      AND table_name IN ('PhoneConfig','Opportunity','ExecutionReceipt','EvidenceLedger','EvidenceSource','EvidenceClaim','BusinessUnit','Venture','Subscription','Invoice','CustomerSuccessState')
  `
  const requiredSet = new Set(required.map(row => row.table_name))
  const missingTables = ['PhoneConfig','Opportunity','ExecutionReceipt','EvidenceLedger','EvidenceSource','EvidenceClaim','BusinessUnit','Venture','Subscription','Invoice','CustomerSuccessState'].filter(name => !requiredSet.has(name))
  if (missingTables.length) throw new Error(`Schema reconciliation incomplete. Missing tables: ${missingTables.join(', ')}`)
  const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
    SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname IN (
      'ExecutionReceipt_missionId_idempotencyKey_key','EvidenceLedger_missionId_idempotencyKey_key','EvidenceLedger_missionId_version_key','EvidenceClaim_ledgerId_claimKey_key',
      'BusinessUnit_ownerUserId_businessKey_key','BusinessUnit_ownerUserId_idx','Venture_ownerUserId_idx','Customer_ventureId_idx','Opportunity_ventureId_idx','Transaction_ventureId_idx','Transaction_customerId_idx','MarketingCampaign_ventureId_idx','IncomeEntry_ventureId_idx','Subscription_ventureId_idx','Invoice_ventureId_idx','CustomerSuccessState_ventureId_customerId_key'
    )
  `
  if (indexes.length !== 16) throw new Error(`Production commercial/proof indexes incomplete: ${indexes.length}/16`)

  const transactionColumns = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='Transaction' AND column_name IN ('ventureId','customerId')
  `
  const transactionColumnSet = new Set(transactionColumns.map(row => row.column_name))
  const missingTransactionColumns = ['ventureId','customerId'].filter(name => !transactionColumnSet.has(name))
  if (missingTransactionColumns.length) throw new Error(`Transaction schema incomplete. Missing columns: ${missingTransactionColumns.join(', ')}`)

  const transactionCustomerFk = await prisma.$queryRaw<Array<{ constraint_name: string }>>`
    SELECT constraint_name FROM information_schema.table_constraints
    WHERE table_schema='public' AND table_name='Transaction' AND constraint_name='Transaction_customerId_fkey' AND constraint_type='FOREIGN KEY'
  `
  if (transactionCustomerFk.length !== 1) throw new Error('Transaction_customerId_fkey foreign key is missing.')

  console.log('Production schema reconciliation verified: proof ledger, owner-scoped business units, venture scope, transaction customer identity, commercial links, subscription, invoice, and customer-success lifecycle tables/indexes/constraints present.')
}

main().catch((error) => { console.error('Production schema reconciliation failed:', error); process.exitCode = 1 }).finally(async () => { await prisma.$disconnect() })
