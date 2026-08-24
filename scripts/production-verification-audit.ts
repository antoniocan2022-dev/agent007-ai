import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { organizationGraphFingerprint } from '../src/lib/organization-graph-fingerprint'

const root = process.cwd()
const expectedSha = process.env.GITHUB_SHA?.trim() || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const actualSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
if (expectedSha !== actualSha) throw new Error(`GitHub release SHA mismatch: expected ${expectedSha}, checked out ${actualSha}.`)

const fingerprint = organizationGraphFingerprint()
const releaseWorkflow = readFileSync(resolve(root, '.github/workflows/production-release-watchdog.yml'), 'utf8')
if (/^\s{2}push:\s*$/m.test(releaseWorkflow)) throw new Error('Production release workflow still contains an automatic push trigger.')
if (!releaseWorkflow.includes('DEPLOY_AGENT007_MAIN')) throw new Error('Production release workflow is missing the explicit deployment authorization gate.')
if (!releaseWorkflow.includes('/api/release-health')) throw new Error('Production release workflow is missing the canonical production health verification.')

const manifest = {
  schemaVersion: 1,
  status: 'READY_FOR_AUTHORIZED_VERCEL_DEPLOY',
  deploymentStatus: 'WITHHELD_PENDING_USER_AUTHORIZATION',
  githubMainSha: actualSha,
  organizationGraphFingerprint: fingerprint,
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
console.log(`Organization graph fingerprint: ${fingerprint}`)
