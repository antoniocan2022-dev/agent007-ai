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

const modelNames = [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((match) => match[1])
const registryBlock = backupV2.match(/export const BACKUP_TABLES = \[(.*?)\] as const/s)?.[1] ?? ''
const registryNames = [...registryBlock.matchAll(/'([A-Za-z0-9_]+)'/g)].map((match) => match[1])

record(modelNames.length > 0, 'Prisma schema model registry is empty')
record(new Set(registryNames).size === registryNames.length, 'BACKUP_TABLES contains duplicate model names')
record(modelNames.length === registryNames.length && modelNames.every((name) => registryNames.includes(name)), 'BACKUP_TABLES does not exactly match Prisma schema models')
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
record(autonomyWorkflow.includes("- main"), 'Autonomy CI does not run on main pushes')

let trackedFiles = ''
try {
  trackedFiles = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
} catch (error) {
  failures.push(`Unable to inspect tracked files: ${error instanceof Error ? error.message : String(error)}`)
}

const forbiddenTracked = trackedFiles.split('\n').filter(Boolean).filter((path) =>
  /(^|\/)(\.env(?:\..*)?|.*\.pid(?:\.lock)?|download\/|tool-results\/|upload\/|db\/)/i.test(path)
  || /public\/.*(?:backup|agent007-backup).*\.(?:zip|json|gz|tar\.gz)$/i.test(path),
)
record(forbiddenTracked.length === 0, `Tracked local/runtime artifacts found: ${forbiddenTracked.join(', ')}`)

if (failures.length > 0) {
  console.error('Deep integrated audit FAILED:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`Deep integrated audit PASSED: ${modelNames.length} Prisma models reconciled and ${trackedFiles.split('\n').filter(Boolean).length} tracked files checked.`)
