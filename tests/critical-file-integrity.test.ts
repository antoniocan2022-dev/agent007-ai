import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dir, '..')
const criticalFiles = [
  '.github/workflows/production-release-watchdog.yml',
  'src/app/api/agent/route.ts',
  'src/lib/ceo-context-composer.ts',
  'src/lib/ceo-cognitive-lifecycle.ts',
  'src/lib/ceo-response-quality-gate.ts',
  'src/lib/ceo-failure-reason.ts',
  '.release/production-deploy.json',
]

describe('critical-file integrity', () => {
  test('critical files exist, decode as valid UTF-8, and contain no display-control corruption', () => {
    for (const relative of criticalFiles) {
      const file = path.join(root, relative)
      const bytes = readFileSync(file)
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      expect(text.includes('\u001b')).toBe(false)
      expect(text.includes('\u0000')).toBe(false)
      expect(text.includes('\ufffd')).toBe(false)
    }
  })

  test('critical JSON release metadata remains syntactically valid and revoked by default', () => {
    const content = readFileSync(path.join(root, '.release/production-deploy.json'), 'utf8')
    const parsed = JSON.parse(content) as Record<string, unknown>
    expect(parsed.repository).toBe('antoniocan2022-dev/agent007-ai')
    expect(parsed.ref).toBe('main')
    expect(parsed.authorization).toBe('DEPLOY_AGENT007_MAIN')
    expect(parsed.target).toBe('production')
    expect(parsed.authorized).toBe(false)
    expect(parsed.sourceMainSha).toBeNull()
  })
})
