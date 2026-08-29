import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dir, '..')
const source = readFileSync(path.join(root, 'scripts/build-release-integrity-manifest.ts'), 'utf8')

const criticalFiles = [
  '.github/workflows/production-release-watchdog.yml',
  'src/app/api/agent/route.ts',
  'src/lib/ceo-context-composer.ts',
  'src/lib/ceo-cognitive-lifecycle.ts',
  'src/lib/ceo-response-quality-gate.ts',
  'src/lib/ceo-failure-reason.ts',
  '.release/production-deploy.json',
]

describe('unified release integrity manifest', () => {
  test('defines the complete release identity chain', () => {
    for (const field of ['releaseSha', 'currentMainSha', 'authorizedSha', 'certifiedSha', 'deploymentSha', 'deploymentId', 'target', 'authorization']) {
      expect(source).toContain(field)
    }
    expect(source).toContain('releaseSha !== mainSha')
    expect(source).toContain("target: 'production'")
    expect(source).toContain("authorization: 'DEPLOY_AGENT007_MAIN'")
  })

  test('covers every critical production-integrity file with blob and byte hashes', () => {
    for (const file of criticalFiles) expect(source).toContain(`'${file}'`)
    expect(source).toContain('gitBlobSha: blobSha(relative)')
    expect(source).toContain("createHash('sha256').update(bytes).digest('hex')")
    expect(source).toContain('byteLength: bytes.byteLength')
  })

  test('supports deterministic CI artifact output without committing generated state', () => {
    expect(source).toContain('process.env.OUTPUT_PATH')
    expect(source).toContain("path.join(ROOT, 'release-integrity-manifest.json')")
  })
})
