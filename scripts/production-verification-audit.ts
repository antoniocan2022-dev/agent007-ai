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
if (!releaseWorkflow.includes('on:\n  push:\n    branches: [main]')) throw new Error('Production release workflow must observe main pushes for the explicit authorized-release path.')
if (!releaseWorkflow.includes('[AUTHORIZED_PRODUCTION_RELEASE]')) throw new Error('Production release workflow is missing the explicit main-push authorization marker.')
if (!releaseWorkflow.includes("github.actor == 'antoniocan2022-dev'")) throw new Error('Production release workflow is missing the authorized GitHub actor guard.')
if (!releaseWorkflow.includes('workflow_dispatch:')) throw new Error('Production release workflow is missing the manual authorization path.')
if (!releaseWorkflow.includes('DEPLOY_AGENT007_MAIN')) throw new Error('Production release workflow is missing the explicit deployment authorization gate.')
if (!releaseWorkflow.includes('/api/release-health')) throw new Error('Production release workflow is missing the canonical production health verification.')

const manifest = {
  schemaVersion: 1,
  status: 'READY_FOR_AUTHORIZED_VERCEL_DEPLOY',
  deploymentStatus: 'AUTHORIZATION_VERIFIED_RELEASE_PATH',
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
console.log(`Phase 8 production verification readiness PASSED for ${actualSha}. Deployment is authorized only through the guarded release controller.`)
console.log(`Organization graph fingerprint: ${fingerprint}`)
