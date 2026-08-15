import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/**
 * Production-safe, additive schema reconciliation.
 *
 * This is intentionally separate from the Vercel build so production
 * deployments never mutate the database implicitly. Every statement is
 * additive and nullable, making reruns idempotent and preserving data.
 */
const statements = [
  'ALTER TABLE "PhoneConfig" ADD COLUMN IF NOT EXISTS "emailImapHost" TEXT',
  'ALTER TABLE "PhoneConfig" ADD COLUMN IF NOT EXISTS "emailImapPort" TEXT',
  'ALTER TABLE "PhoneConfig" ADD COLUMN IF NOT EXISTS "emailImapUser" TEXT',
  'ALTER TABLE "PhoneConfig" ADD COLUMN IF NOT EXISTS "emailImapPassword" TEXT',
  'ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "source" TEXT',
  'ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "url" TEXT',
  'ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "riskScore" INTEGER',
  'ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "estIncome" DOUBLE PRECISION',
]

async function main() {
  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement)
  }

  const phoneConfig = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'PhoneConfig'
      AND column_name IN ('emailImapHost','emailImapPort','emailImapUser','emailImapPassword')
    ORDER BY column_name
  `

  const opportunity = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Opportunity'
      AND column_name IN ('source','url','riskScore','estIncome')
    ORDER BY column_name
  `

  if (phoneConfig.length !== 4 || opportunity.length !== 4) {
    throw new Error(
      `Schema reconciliation incomplete: PhoneConfig=${phoneConfig.length}/4 Opportunity=${opportunity.length}/4`,
    )
  }

  console.log('Production schema reconciliation verified: 8 additive columns present.')
}

main()
  .catch((error) => {
    console.error('Production schema reconciliation failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
