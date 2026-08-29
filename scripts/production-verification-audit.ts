import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { organizationGraphFingerprint } from '../src/lib/organization-graph-fingerprint'

const root = process.cwd()
const expectedSha = process.env.GITHUB_SHA?.trim() || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const actualSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
if (expectedSha !== actualSha) throw new Error(`GitHub release SHA mismatch: expected ${expectedSha}, checked out ${actualSha}.`)

const fingerprint = organizationGraphFingerprint()
const releaseWorkflowPath = resolve(root, '.github/workflows/production-release-watchdog.yml')
const releaseWorkflow = readFileSync(releaseWorkflowPath, 'utf8')

if (!releaseWorkflow.includes('on:\n  workflow_dispatch:')) {
  throw new Error('Production release workflow must expose workflow_dispatch as the explicit authorization path.')
}
if (!releaseWorkflow.includes('release_sha:')) {
  throw new Error('Production release workflow must require an exact release SHA.')
}
if (!releaseWorkflow.includes('github.event_name == \'workflow_dispatch\' && inputs.authorization == \'DEPLOY_AGENT007_MAIN\'')) {
  throw new Error('Production release workflow is missing the explicit DEPLOY_AGENT007_MAIN authorization gate.')
}
if (!releaseWorkflow.includes("github.event_name == 'push' && github.ref == 'refs/heads/main' && github.event.head_commit.message == 'authorized production deployment'")) {
  throw new Error('Production release workflow is missing the one-shot owner-authorized main release marker boundary.')
}
if (!releaseWorkflow.includes('.release/production-deploy.json')) {
  throw new Error('Production release workflow is missing the one-shot authorization marker.')
}
if (!releaseWorkflow.includes('git ls-remote origin refs/heads/main')) {
  throw new Error('Production release workflow is missing the authoritative main SHA check.')
}
if (!releaseWorkflow.includes('Wait for all exact-SHA CI certification gates')) {
  throw new Error('Production release workflow is missing the all-workflow exact-SHA CI gate.')
}
if (!releaseWorkflow.includes('environment: production')) {
  throw new Error('Production release workflow is missing the production environment boundary.')
}
if (!releaseWorkflow.includes('concurrency:') || !releaseWorkflow.includes('group: agent007-production-release')) {
  throw new Error('Production release workflow is missing the serialized production-release lock.')
}
if (!releaseWorkflow.includes('STALE_ALIAS') || !releaseWorkflow.includes('DUAL_ALIAS_CONFLICT')) {
  throw new Error('Production release workflow is missing explicit alias-integrity failure markers.')
}
if (!releaseWorkflow.includes('TRAFFIC_OWNERSHIP_UNPROVEN')) {
  throw new Error('Production release workflow is missing explicit traffic-ownership failure proof.')
}
if (!releaseWorkflow.includes('EXPECTED_RELEASE_SHA')) {
  throw new Error('Production release workflow is missing exact release-SHA propagation into the live canary.')
}
if (!releaseWorkflow.includes('/api/release-health')) {
  throw new Error('Production release workflow is missing canonical production health verification.')
}
if (!releaseWorkflow.includes('.proof.tripleProof')) {
  throw new Error('Production release workflow is missing triple-proof verification.')
}
if (!releaseWorkflow.includes('.actualExecution.verified')) {
  throw new Error('Production release workflow is missing real provider-execution verification.')
}

const vercelConfig = JSON.parse(readFileSync(resolve(root, 'vercel.json'), 'utf8')) as { git?: { deploymentEnabled?: boolean } }
if (vercelConfig.git?.deploymentEnabled !== false) {
  throw new Error('Vercel Git auto-deployment must remain disabled; production is controlled by the guarded release workflow.')
}

const manifest = {
  schemaVersion: 2,
  status: 'READY_FOR_AUTHORIZED_VERCEL_DEPLOY',
  deploymentStatus: 'MANUAL_AUTHORIZATION_REQUIRED',
  githubMainSha: actualSha,
  organizationGraphFingerprint: fingerprint,
  canonicalOrganization: 'src/lib/commercial-organization.ts',
  canonicalVentureScope: 'src/lib/commercial-organization-scope.ts',
  canonicalAuthority: 'src/lib/architecture-control-plane.ts',
  canonicalRuntime: 'src/lib/venture-operation-loop.ts',
  productionReleaseController: '.github/workflows/production-release-watchdog.yml',
  oneShotAuthorizationMarker: '.release/production-deploy.json',
  productionHealthEndpoint: 'https://agent007-ai.vercel.app/api/release-health',
  productionComparisonPlan: {
    githubGraph: 'fingerprint generated from canonical organization source',
    deployedCode: 'must report the exact GitHub main SHA through /api/release-health',
    runtimeGraph: 'must report the same organizationGraphFingerprint through /api/release-health',
    liveTraffic: 'must report the exact release SHA and Vercel deployment identity through /api/release-health',
  },
  generatedAt: new Date().toISOString(),
}

mkdirSync(resolve(root, '.artifacts'), { recursive: true })
writeFileSync(resolve(root, '.artifacts/production-verification-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(`Phase 8 production verification readiness PASSED for ${actualSha}. Deployment is authorized only through the guarded release controller.`)
console.log(`Organization graph fingerprint: ${fingerprint}`)
