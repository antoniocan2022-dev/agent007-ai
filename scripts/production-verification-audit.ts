import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { COMMERCIAL_ORGANIZATION } from '../src/lib/commercial-organization'

const root = process.cwd()
const expectedSha = process.env.GITHUB_SHA?.trim() || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const actualSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
if (expectedSha !== actualSha) throw new Error(`GitHub release SHA mismatch: expected ${expectedSha}, checked out ${actualSha}.`)

const canonicalGraph = [...COMMERCIAL_ORGANIZATION]
  .map((node) => ({
    id: node.id,
    title: node.title,
    division: node.division,
    mission: node.mission,
    level: node.level,
    reportsTo: node.reportsTo,
    businesses: [...node.businesses].sort(),
  }))
  .sort((a, b) => a.id.localeCompare(b.id))

const organizationGraphFingerprint = createHash('sha256')
  .update(JSON.stringify(canonicalGraph))
  .digest('hex')

const releaseWorkflow = readFileSync(resolve(root, '.github/workflows/production-release-watchdog.yml'), 'utf8')
if (/^\s{2}push:\s*$/m.test(releaseWorkflow)) throw new Error('Production release workflow still contains an automatic push trigger.')
if (!releaseWorkflow.includes('DEPLOY_AGENT007_MAIN')) throw new Error('Production release workflow is missing the explicit deployment authorization gate.')
if (!releaseWorkflow.includes('/api/release-health')) throw new Error('Production release workflow is missing the canonical production health verification.')

const manifest = {
  schemaVersion: 1,
  status: 'READY_FOR_AUTHORIZED_VERCEL_DEPLOY',
  deploymentStatus: 'WITHHELD_PENDING_USER_AUTHORIZATION',
  githubMainSha: actualSha,
  organizationGraphFingerprint,
  canonicalOrganization: 'src/lib/commercial-organization.ts',
  canonicalVentureScope: 'src/lib/commercial-organization-scope.ts',
  canonicalAuthority: 'src/lib/architecture-control-plane.ts',
  canonicalRuntime: 'src/lib/venture-operation-loop.ts',
  productionHealthEndpoint: 'https://agent007-ai.vercel.app/api/release-health',
  productionComparisonPlan: {
    githubGraph: 'fingerprint generated from canonical organization source',
    deployedCode: 'must report the exact GitHub main SHA through /api/release-health',
    runtimeGraph: 'must report the same organizationGraphFingerprint through /api/release-health',
  },
  generatedAt: new Date().toISOString(),
}

mkdirSync(resolve(root, '.artifacts'), { recursive: true })
writeFileSync(resolve(root, '.artifacts/production-verification-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(`Phase 8 production verification readiness PASSED for ${actualSha}. Deployment remains withheld pending explicit user authorization.`)
console.log(`Organization graph fingerprint: ${organizationGraphFingerprint}`)
