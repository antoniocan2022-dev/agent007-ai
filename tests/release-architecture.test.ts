import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

const ROOT = process.cwd()
const CANONICAL_WORKFLOW = join(ROOT, '.github/workflows/production-release-watchdog.yml')

function workflowContent(path = CANONICAL_WORKFLOW): string {
  const fs = require('node:fs')
  return fs.readFileSync(path, 'utf8')
}

describe('permanent production release architecture', () => {
  test('has exactly one workflow capable of deploying or promoting production', () => {
    const fs = require('node:fs')
    const workflows = fs.readdirSync(join(ROOT, '.github/workflows')).filter((file: string) => file.endsWith('.yml') || file.endsWith('.yaml'))
    const deployers = workflows.filter((file: string) => /vercel|deploy|production/i.test(file))
    expect(deployers).toEqual(['production-release-watchdog.yml'])
  })

  test('has no direct production deploy scripts outside GitHub Actions', () => {
    const fs = require('node:fs')
    const files: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.next') continue
        const full = join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else files.push(full)
      }
    }
    walk(join(ROOT, 'scripts'))
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8')
      expect(content).not.toMatch(/vercel\s+--prod|vercel\.com\/v\d+\/deployments/i)
    }
  })

  test('keeps Vercel Git auto-deployment disabled', () => {
    const fs = require('node:fs')
    const vercel = JSON.parse(fs.readFileSync(join(ROOT, 'vercel.json'), 'utf8'))
    expect(vercel.git?.deploymentEnabled ?? false).toBe(false)
  })

  test('has only the canonical explicit or one-shot owner-authorized release surfaces', () => {
    const content = workflowContent()
    expect(content).toContain('workflow_dispatch:')
    expect(content).toContain('inputs:')
    expect(content).toContain('authorization:')
    expect(content).toContain('release_sha:')
    expect(content).toContain('DEPLOY_AGENT007_MAIN')
    expect(content).toContain('github.event.head_commit.message == \'authorized production deployment\'')
    expect(content).toContain('environment: production')
  })

  test('has a serialized production concurrency lock', () => {
    const content = workflowContent(CANONICAL_WORKFLOW)
    expect(content).toContain('concurrency:')
    expect(content).toContain('group: agent007-production-release')
    expect(content).toContain('cancel-in-progress: false')
  })

  test('requires exact certified source SHA before any production mutation', () => {
    const content = workflowContent(CANONICAL_WORKFLOW)
    const identity = content.indexOf('Validate authorization and immutable release identity')
    const deploy = content.indexOf('Deploy exact certified main checkout to Vercel production')
    expect(identity).toBeGreaterThanOrEqual(0)
    expect(deploy).toBeGreaterThan(identity)
    expect(content).toContain('git ls-remote origin refs/heads/main')
    expect(content).toContain('Wait for all exact-SHA CI certification gates')
    expect(content).toContain('source_sha=')
    expect(content).toContain('gh api "repos/${GITHUB_REPOSITORY}/commits/${source_sha}"')
  })

  test('makes real production traffic ownership the release proof', () => {
    const content = workflowContent(CANONICAL_WORKFLOW)
    const deploy = content.indexOf('Deploy exact certified main checkout to Vercel production')
    const aliases = content.indexOf('Reconcile canonical production aliases')
    const traffic = content.indexOf('Verify canonical aliases and production traffic identity')
    const health = content.indexOf('Verify fresh production release health')
    expect(deploy).toBeGreaterThanOrEqual(0)
    expect(aliases).toBeGreaterThan(deploy)
    expect(traffic).toBeGreaterThan(aliases)
    expect(health).toBeGreaterThan(traffic)
    expect(content).toContain('TRAFFIC_OWNERSHIP_UNPROVEN')
    expect(content).toContain('STALE_ALIAS')
  })

  test('uses canonical release-health over HTTPS for production traffic identity proof', () => {
    const content = workflowContent(CANONICAL_WORKFLOW)
    const canary = content.slice(content.indexOf('Verify canonical aliases and production traffic identity'), content.indexOf('Verify fresh production release health'))
    expect(canary).toContain('curl --fail-with-body --silent --show-error --max-time 30')
    expect(canary).toContain('"$PRODUCTION_URL/api/release-health"')
    expect(canary).toContain('EXPECTED_RELEASE_SHA')
    expect(canary).toContain('TARGET_DEPLOYMENT_ID')
  })

  test('keeps alias verification authoritative and project-scoped', () => {
    const content = workflowContent(CANONICAL_WORKFLOW)
    expect(content).toContain('https://api.vercel.com/v4/aliases/$domain?projectId=$VERCEL_PROJECT_ID&teamId=$VERCEL_ORG_ID')
    expect(content).toContain('DUAL_ALIAS_CONFLICT')
  })

  test('keeps release-health proof after traffic', () => {
    const content = workflowContent(CANONICAL_WORKFLOW)
    const traffic = content.indexOf('Verify canonical aliases and production traffic identity')
    const health = content.indexOf('Verify fresh production release health')
    expect(health).toBeGreaterThan(traffic)
    expect(content).toContain('organizationGraphFingerprint')
    expect(content).toContain('actualExecution.verified')
  })

  test('stamps every Agent007 SSE envelope with deployment identity', () => {
    const content = workflowContent(join(ROOT, 'src/app/api/agent/route.ts'))
    expect(content).toContain('releaseCommit')
    expect(content).toContain('deploymentId')
    expect(content).toContain('event: ${event}')
  })

  test('exposes deployment identity and real provider execution in release-health', () => {
    const fs = require('node:fs')
    const candidates = [
      join(ROOT, 'src/app/api/release-health/route.ts'),
      join(ROOT, 'src/app/api/release-health/route.js'),
    ]
    const path = candidates.find((candidate) => fs.existsSync(candidate))
    expect(path).toBeTruthy()
    const content = fs.readFileSync(path, 'utf8')
    expect(content).toContain('actualExecution')
    expect(content).toContain('tripleProof')
    expect(content).toContain('organizationGraphFingerprint')
    expect(content).toContain('deploymentIdentityVerified')
  })
})
