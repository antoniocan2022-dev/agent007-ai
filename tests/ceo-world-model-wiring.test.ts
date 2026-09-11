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
    // Track 2: the primary path now passes composed.canonicalSemanticContext rather than
    // contextSeed's -- composeCeoContext's reuseSemanticContext option makes these the exact same
    // object by construction (see tests/ceo-context-composer-reuse.test.ts), so this remains a real
    // supplied context, not a regression to undefined.
    expect(source).toContain('canonicalContext: composed.canonicalSemanticContext')
    expect(source).toContain('canonicalContext: composedOperational.canonicalSemanticContext')
  })

  test('route.ts fetches real partner intelligence and both CEO lanes actually receive it', () => {
    const source = readFileSync(join(ROOT, 'src/app/api/agent/route.ts'), 'utf-8')
    expect(source).toContain('getPartnerIntelligence(sessionUserId)')
    expect(source.match(/partnerIntelligence\s*\}\)\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })

  test('the world model builds the partners facet from real telemetry, not a permanent placeholder', () => {
    const worldModelSource = readFileSync(join(ROOT, 'src/lib/ceo-world-model.ts'), 'utf-8')
    expect(worldModelSource).toContain("partners: { updatedAt: now, data: input.partners ?? EMPTY_PARTNER_INTELLIGENCE }")
    const lifecycleSource = readFileSync(join(ROOT, 'src/lib/ceo-cognitive-lifecycle.ts'), 'utf-8')
    expect(lifecycleSource).toContain('partners: request.partnerIntelligence')
    expect(lifecycleSource).toContain('renderPartnerIntelligenceContext(worldModel.partners.data)')
  })
})
