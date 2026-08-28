import { describe, expect, it } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const WORKFLOWS_DIR = join(ROOT, '.github', 'workflows')
const CANONICAL_WORKFLOW = 'production-release-watchdog.yml'

function workflowFiles(): string[] {
  return readdirSync(WORKFLOWS_DIR).filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
}

function workflowContent(name: string): string {
  return readFileSync(join(WORKFLOWS_DIR, name), 'utf8')
}

function productionDeploymentOperation(content: string): boolean {
  const executableLines = content
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+#.*$/, '').trim())
    .filter(Boolean)

  const directDeployCommand = /^(?:npx\s+--yes\s+)?vercel(?:@[^\s]+)?\s+(?:deploy|promote)\b.*(?:--prod\b|--target\s+production\b|production\b)/i
  const shorthandDeployCommand = /^(?:npx\s+--yes\s+)?vercel(?:@[^\s]+)?\s+--prod\b/i
  const childProcessDeploy = /\b(?:execFileSync|execSync|spawn|spawnSync)\(\s*['"`]?(?:[^'"`]*\/)?vercel(?:@[^'"`\s]+)?['"`]?[,)]/i
  const childProcessArgsDeploy = /\b(?:execFileSync|spawn|spawnSync)\([^\n]*(?:deploy|promote)[^\n]*(?:--prod|production)/i
  const shellCurlDeploy = /^(?:curl|\$\{[^}]+\})[^\n]*(?:POST[^\n]*)?\/v\d+\/deployments(?:\?|\s|["'])/i
  const childProcessCurlDeploy = /\b(?:execFileSync|execSync|spawn|spawnSync)\([^\n]*(?:POST|--request\s+POST)[^\n]*\/v\d+\/deployments(?:\?|\s|["'])/i

  return executableLines.some((line) =>
    directDeployCommand.test(line) ||
    shorthandDeployCommand.test(line) ||
    childProcessDeploy.test(line) ||
    childProcessArgsDeploy.test(line) ||
    shellCurlDeploy.test(line) ||
    childProcessCurlDeploy.test(line),
  )
}

function productionScriptFiles(): string[] {
  const scriptsDir = join(ROOT, 'scripts')
  return readdirSync(scriptsDir)
    .filter((name) => /\.(?:sh|cjs|mjs|ts|js)$/.test(name))
    .map((name) => join(scriptsDir, name))
    .filter((path) => statSync(path).isFile())
}

describe('permanent production release architecture', () => {
  it('has exactly one workflow capable of deploying or promoting production', () => {
    const deployers = workflowFiles().filter((name) => productionDeploymentOperation(workflowContent(name)))
    expect(deployers).toEqual([CANONICAL_WORKFLOW])
  })

  it('has no direct production deploy scripts outside GitHub Actions', () => {
    const offenders = productionScriptFiles()
      .filter((path) => productionDeploymentOperation(readFileSync(path, 'utf8')))
      .map((path) => path.replace(`${ROOT}/`, ''))
    expect(offenders).toEqual([])
  })

  it('keeps Vercel Git auto-deployment disabled', () => {
    const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'))
    expect(vercel.git?.deploymentEnabled).toBe(false)
  })

  it('uses workflow_dispatch as the only production authorization surface', () => {
    const content = workflowContent(CANONICAL_WORKFLOW)
    expect(content).toContain('on:\n  workflow_dispatch:')
    expect(content).not.toContain('on:\n  push:')
    expect(content).toContain("if: ${{ inputs.authorization == 'DEPLOY_AGENT007_MAIN' }}")
    expect(content).toContain('environment: production')
  })

  it('has a serialized production concurrency lock', () => {
    const content = workflowContent(CANONICAL_WORKFLOW)
    expect(content).toContain('concurrency:')
    expect(content).toContain('group: agent007-production-release')
    expect(content).toContain('cancel-in-progress: false')
  })

  it('requires exact main SHA before any production mutation', () => {
    const content = workflowContent(CANONICAL_WORKFLOW)
    const identity = content.indexOf('Establish immutable release identity')
    const deploy = content.indexOf('Validate or build immutable production target')
    expect(identity).toBeGreaterThanOrEqual(0)
    expect(deploy).toBeGreaterThan(identity)
    expect(content).toContain('git ls-remote origin refs/heads/main')
    expect(content).toContain('Wait for exact-SHA CI gates')
  })

  it('makes real production traffic ownership the first proof before broad SHA/fingerprint checks', () => {
    const content = workflowContent(CANONICAL_WORKFLOW)
    const alias = content.indexOf('Verify alias ownership and legacy exclusion')
    const traffic = content.indexOf('Generate production traffic canary')
    const trafficOwnership = content.indexOf('Verify fresh traffic ownership and legacy runtime exclusion')
    const broadProof = content.indexOf('Verify release health and broader SHA/fingerprint proof')
    expect(alias).toBeGreaterThanOrEqual(0)
    expect(traffic).toBeGreaterThan(alias)
    expect(trafficOwnership).toBeGreaterThan(traffic)
    expect(broadProof).toBeGreaterThan(trafficOwnership)
    expect(content).toContain('TRAFFIC_OWNERSHIP_UNPROVEN')
    expect(content).toContain('LEGACY_RUNTIME')
    expect(content).toContain('STALE_ALIAS')
    expect(content).toContain('DUAL_ALIAS_CONFLICT')
  })

  it('uses the production URL, not a deployment URL, for the protected /api/agent canary', () => {
    const content = workflowContent(CANONICAL_WORKFLOW)
    expect(content).toContain('vercel@$VERCEL_CLI_VERSION curl \"$PRODUCTION_URL/api/agent\"')
    expect(content).not.toContain('curl /api/agent --deployment \"$TARGET_DEPLOYMENT_URL\"')
    expect(content).toContain('EXPECTED_RELEASE_SHA')
    expect(content).toContain('TARGET_DEPLOYMENT_ID')
  })

  it('keeps alias verification authoritative and project-scoped', () => {
    const content = workflowContent(CANONICAL_WORKFLOW)
    expect(content).toContain('/v4/aliases/$domain?projectId=$VERCEL_PROJECT_ID&teamId=$VERCEL_ORG_ID')
    expect(content).toContain('/v2/deployments/$TARGET_DEPLOYMENT_ID/aliases')
  })

  it('keeps broader SHA and organization fingerprint proof after traffic', () => {
    const content = workflowContent(CANONICAL_WORKFLOW)
    expect(content).toContain('/api/release-health')
    expect(content).toContain('organizationGraphFingerprint')
    expect(content).toContain('.proof.tripleProof')
    expect(content).toContain('.proof.deploymentIdentityVerified')
  })

  it('stamps every Agent007 SSE envelope with deployment identity', () => {
    const route = readFileSync(join(ROOT, 'src', 'app', 'api', 'agent', 'route.ts'), 'utf8')
    expect(route).toContain('VERCEL_DEPLOYMENT_ID')
    expect(route).toContain('VERCEL_GIT_COMMIT_SHA')
    expect(route).toContain('function sse(event: string, data: unknown)')
    expect(route).toContain('deploymentId: identity.deploymentId')
    expect(route).toContain('releaseCommit: identity.releaseCommit')
    expect(route).toContain('Every SSE envelope is stamped here')
  })

  it('exposes deployment identity and real provider execution in release-health', () => {
    const health = readFileSync(join(ROOT, 'src', 'app', 'api', 'release-health', 'route.ts'), 'utf8')
    expect(health).toContain('VERCEL_DEPLOYMENT_ID')
    expect(health).toContain('deploymentIdentityVerified')
    expect(health).toContain('runGovernedProviderChat')
    expect(health).not.toContain('actualExecution.verified: false')
  })
})
