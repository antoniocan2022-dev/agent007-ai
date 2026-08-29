#!/usr/bin/env bun
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const failures: string[] = []
const read = (path: string) => readFileSync(path, 'utf8')
const record = (condition: boolean, message: string) => {
  if (!condition) failures.push(message)
}

const schema = read('prisma/schema.prisma')
const backupV2 = read('src/lib/backup-v2.ts')
const backupFunctions = read('src/lib/backup-functions.ts')
const nextConfig = read('next.config.ts')
const fulfillment = read('src/lib/product-fulfillment.ts')
const downloadLink = read('src/app/api/download-link/route.ts')
const stripeWebhook = read('src/app/api/webhooks/stripe/route.ts')
const autonomyWorkflow = read('.github/workflows/autonomy-ci.yml')
const proofLedger = read('src/lib/proof-ledger.ts')
const proofTest = read('tests/proof-ledger-contract.test.ts')
const reconcile = read('src/lib/reconcile-production-schema.ts')
const evidenceSourceModel = schema.match(/model\s+EvidenceSource\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''

const modelNames = [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((match) => match[1])
const registryBlock = backupV2.match(/export const BACKUP_TABLES = \[(.*?)\] as const/s)?.[1] ?? ''
const registryNames = [...registryBlock.matchAll(/'([A-Za-z0-9_]+)'/g)].map((match) => match[1])
const coreModelNames = modelNames.filter((name) => !['ExecutionReceipt', 'EvidenceLedger', 'EvidenceSource', 'EvidenceClaim'].includes(name))
const proofModelNames = ['ExecutionReceipt', 'EvidenceLedger', 'EvidenceSource', 'EvidenceClaim']

record(modelNames.length > 0, 'Prisma schema model registry is empty')
record(new Set(registryNames).size === registryNames.length, 'BACKUP_TABLES contains duplicate model names')
record(coreModelNames.length === registryNames.length && coreModelNames.every((name) => registryNames.includes(name)), 'BACKUP_TABLES does not exactly match the non-proof Prisma schema models')
record(proofModelNames.every((name) => modelNames.includes(name)), 'Proof ledger Prisma models are missing from schema')
record(proofModelNames.every((name) => backupFunctions.includes(name.charAt(0).toLowerCase() + name.slice(1))), 'System backup inventory does not include all proof ledger tables')
record(proofModelNames.every((name) => backupFunctions.includes(`'${name.charAt(0).toLowerCase() + name.slice(1)}'`)), 'System backup inventory proof-table assertions are incomplete')
record(!nextConfig.includes('ignoreBuildErrors: true'), 'Next.js production build still ignores TypeScript errors')
record(!backupFunctions.includes('/home/z/my-project'), 'Legacy backup code still contains a machine-specific development path')
record(!backupFunctions.includes('process.env.VERCEL'), 'Legacy backup code still reads Vercel environment state directly')
record(fulfillment.includes('randomBytes(32)'), 'Fulfillment tokens are not cryptographically generated')
record(fulfillment.includes('ownerUserId'), 'Fulfillment token creation is not owner-bound')
record(fulfillment.includes('checkoutSessionId'), 'Fulfillment does not persist checkout-session identity')
record(downloadLink.includes('checkoutSessionId'), 'Download-link flow does not resolve checkout-session identity')
record(downloadLink.includes('getPublicBaseUrl()'), 'Download-link flow does not use canonical public URL resolver')
record(!downloadLink.includes('agent007-ai.vercel.app'), 'Download-link flow contains historical Vercel hostname')
record(stripeWebhook.includes('pg_advisory_xact_lock'), 'Stripe derived-ledger path lacks concurrency locking')
record(stripeWebhook.includes('ownerUserId: owner.id'), 'Stripe fulfillment is not bound to verified owner')
record(stripeWebhook.includes('checkoutSessionId'), 'Stripe fulfillment does not pass checkout-session identity')
record(/(?:^|\n)\s*-\s*main\b/m.test(autonomyWorkflow) || /branches:\s*\[[^\]]*\bmain\b[^\]]*\]/m.test(autonomyWorkflow), 'Autonomy CI does not run on main pushes')

record(proofLedger.includes('recordExecutionReceipt'), 'Execution proof service does not expose receipt persistence')
record(proofLedger.includes('persistEvidenceLedger'), 'Evidence proof service does not expose ledger persistence')
record(proofLedger.includes('verifyEvidenceLedger'), 'Evidence proof service does not expose ledger verification')
record(proofLedger.includes('sha256'), 'Proof service does not provide SHA-256 hashing')
record(proofLedger.includes('idempotencyKey'), 'Proof service lacks idempotency enforcement')
record(proofLedger.includes('rawEvidenceHash'), 'Evidence provenance does not hash raw evidence')
record(!/\brawEvidence\s+(String|Text|Json)\b/i.test(evidenceSourceModel), 'EvidenceSource Prisma model must not persist raw evidence payloads directly')
record(!/data:\s*\{[^}]*rawEvidence\s*:/s.test(proofLedger), 'Evidence persistence path must not write a rawEvidence field to the database')
record(proofTest.includes('proof models and uniqueness guards exist'), 'Proof ledger regression test is missing schema uniqueness coverage')
record(reconcile.includes('ExecutionReceipt'), 'Production schema reconciliation does not include ExecutionReceipt')
record(reconcile.includes('EvidenceLedger'), 'Production schema reconciliation does not include EvidenceLedger')
record(reconcile.includes('EvidenceSource'), 'Production schema reconciliation does not include EvidenceSource')
record(reconcile.includes('EvidenceClaim'), 'Production schema reconciliation does not include EvidenceClaim')

let trackedFiles = ''
try {
  trackedFiles = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
} catch (error) {
  failures.push(`Unable to inspect tracked files: ${error instanceof Error ? error.message : String(error)}`)
}

const forbiddenTracked = trackedFiles.split('\n').filter(Boolean).filter((path) =>
  /^(?:\.env(?:\..*)?|download\/|tool-results\/|upload\/|db\/)/i.test(path)
  || /(^|\/)[^/]*\.pid(?:\.lock)?$/i.test(path)
  || /public\/.*(?:backup|agent007-backup).*\.(?:zip|json|gz|tar\.gz)$/i.test(path),
)
record(forbiddenTracked.length === 0, `Tracked local/runtime artifacts found: ${forbiddenTracked.join(', ')}`)

if (failures.length > 0) {
  console.error('Deep integrated audit FAILED:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`Deep integrated audit PASSED: ${modelNames.length} Prisma models reconciled, proof ledger covered, and ${trackedFiles.split('\n').filter(Boolean).length} tracked files checked.`)
