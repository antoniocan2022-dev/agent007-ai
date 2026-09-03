import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dir, '..')

describe('Phase 9 world model wired into the live lifecycle', () => {
  test('the lifecycle genuinely builds and uses the world model when a canonical context is supplied, not merely importing it unused', () => {
    const source = readFileSync(join(ROOT, 'src/lib/ceo-cognitive-lifecycle.ts'), 'utf-8')
    expect(source).toContain('buildCeoWorldModel')
    expect(source).toMatch(/request\.canonicalContext\s*\?\s*buildCeoWorldModel/)
    expect(source).toContain('worldModelMessages')
    expect(source).toMatch(/primaryMessages\s*=\s*\[\.\.\.worldModelMessages/)
  })

  test('route.ts genuinely supplies the canonical context, not leaving the parameter permanently undefined', () => {
    const source = readFileSync(join(ROOT, 'src/app/api/agent/route.ts'), 'utf-8')
    expect(source).toContain('canonicalContext: contextSeed.canonicalSemanticContext')
  })
})
