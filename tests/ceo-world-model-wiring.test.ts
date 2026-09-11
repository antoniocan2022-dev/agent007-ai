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
    expect(source.match(/partnerIntelligence,\s*executiveState,\s*leadershipLedger\s*\}\)\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })

  test('the world model builds the partners facet from real telemetry, not a permanent placeholder', () => {
    const worldModelSource = readFileSync(join(ROOT, 'src/lib/ceo-world-model.ts'), 'utf-8')
    expect(worldModelSource).toContain("partners: { updatedAt: now, data: input.partners ?? EMPTY_PARTNER_INTELLIGENCE }")
    const lifecycleSource = readFileSync(join(ROOT, 'src/lib/ceo-cognitive-lifecycle.ts'), 'utf-8')
    expect(lifecycleSource).toContain('partners: request.partnerIntelligence')
    expect(lifecycleSource).toContain('renderPartnerIntelligenceContext(worldModel.partners.data)')
  })

  test('route.ts fetches real executive state, gated to self-assessment turns since it is backed by the heavier operational-KPI computation', () => {
    const source = readFileSync(join(ROOT, 'src/app/api/agent/route.ts'), 'utf-8')
    expect(source).toContain("executionContract.intent === 'self_assessment' ? await getExecutiveBusinessState(")
    expect(source.match(/partnerIntelligence,\s*executiveState,\s*leadershipLedger\s*\}\)\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })

  test('the world model builds the executive facet from real strategy/risk/resource state, and surfaces the commitments the snapshot already computed but previously discarded', () => {
    const worldModelSource = readFileSync(join(ROOT, 'src/lib/ceo-world-model.ts'), 'utf-8')
    expect(worldModelSource).toContain("executive: { updatedAt: now, data: input.executive ?? EMPTY_EXECUTIVE_BUSINESS_STATE }")
    expect(worldModelSource).toContain('const commitments = snapshot.commitments')
    expect(worldModelSource).toContain('commitments }')
    const lifecycleSource = readFileSync(join(ROOT, 'src/lib/ceo-cognitive-lifecycle.ts'), 'utf-8')
    expect(lifecycleSource).toContain('executive: request.executiveState')
    expect(lifecycleSource).toContain('renderExecutiveBusinessStateContext(worldModel!.executive.data)')
    // Guardian risk awareness must reach every generation stage -- inserting the new executive-state
    // message must not have broken that adjacency (see tests/ceo-guardian.test.ts,
    // tests/ceo-control-reachability-matrix.test.ts).
    expect(lifecycleSource.match(/\[\.\.\.worldModelMessages, \.\.\.guardianMessages,/g)?.length ?? 0).toBeGreaterThanOrEqual(4)
  })

  test('route.ts fetches the real leadership performance ledger under the same self-assessment gate as executive state', () => {
    const source = readFileSync(join(ROOT, 'src/app/api/agent/route.ts'), 'utf-8')
    expect(source).toContain("executionContract.intent === 'self_assessment' ? await getLeadershipPerformanceLedger(sessionUserId)")
  })

  test('the world model builds the leadership facet, and the lifecycle synthesizes one cross-domain judgment from it plus partners/executive/system state', () => {
    const worldModelSource = readFileSync(join(ROOT, 'src/lib/ceo-world-model.ts'), 'utf-8')
    expect(worldModelSource).toContain('leadership: { updatedAt: now, data: input.leadership ?? [] }')
    const lifecycleSource = readFileSync(join(ROOT, 'src/lib/ceo-cognitive-lifecycle.ts'), 'utf-8')
    expect(lifecycleSource).toContain('leadership: worldModel.leadership.data')
    expect(lifecycleSource).toContain('synthesizeExecutiveDecision(')
    expect(lifecycleSource).toContain('renderExecutiveDecisionSynthesis(decisionSynthesis!)')
  })
})
