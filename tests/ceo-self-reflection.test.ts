import { describe, expect, test } from 'bun:test'
import { classifyCeoSelfReflection, synthesizeExecutiveReadiness } from '@/lib/ceo-self-reflection'
import { classifyExecution } from '@/lib/adaptive-execution'
import { preRouteCeoRequest } from '@/lib/ceo-pre-router'
import { evaluateCeoQuality } from '@/lib/ceo-response-quality-gate'

const user = (content: string) => [{ role: 'user' as const, content }]

describe('CEO self-reflection canonical classifier', () => {
  test.each([
    ['How are you doing?', 'casual_checkin'],
    ["How's it going?", 'casual_checkin'],
    ['You good?', 'casual_checkin'],
    ["What's new with you?", 'casual_checkin'],
    ['Are you improving?', 'performance_reflection'],
    ['How are you performing?', 'performance_reflection'],
    ['What are your weaknesses?', 'capability_assessment'],
    ['What are your strengths?', 'capability_assessment'],
    ['How capable are you?', 'capability_assessment'],
    ['Are you ready to manage a business?', 'readiness_assessment'],
    ['Are you prepared to run a company?', 'readiness_assessment'],
    ['Hows it going? make a sekf analysis and tell me if you are ready to mange businesses?', 'readiness_assessment'],
  ] as const)('classifies %j as %s', (text, expected) => {
    const result = classifyCeoSelfReflection(text)
    expect(result.isSelfReflective).toBe(true)
    expect(result.kind).toBe(expected)
  })

  test.each([
    'Deploy the approved release to production.',
    'Research Agent007 competitors.',
    'Send the customer the invoice.',
    'Create a new venture.',
    'Manage this business for me.',
    'Can you analyze this architecture?',
    'Run this business transaction for me.',
    'Review this customer churn report.',
  ])('does not steal operational or analytical request: %s', (text) => {
    expect(classifyCeoSelfReflection(text).isSelfReflective).toBe(false)
  })

  test('keeps casual self-reflection on the bounded fast execution class', () => {
    const plan = classifyExecution(user('How are you doing?'))
    expect(plan.executionClass).toBe('fast')
    expect(plan.maxProviderAttempts).toBe(4)
    expect(plan.timeoutMs).toBe(30000)
    expect(plan.parallelizable).toBe(false)
  })

  test('pre-router emits the canonical self-assessment contract and subtype', () => {
    const decision = preRouteCeoRequest(user('Are you ready to manage businesses?'))
    expect(decision.executionContract.intent).toBe('self_assessment')
    expect(decision.executionContract.selfReflectionKind).toBe('readiness_assessment')
    expect(decision.executionContract.executionRequirement).toBe('llm_only')
    expect(decision.executionContract.orchestrationOwner).toBe('ceo_lifecycle')
    expect(decision.executionContract.latencyBudgetMs).toBe(30000)
    expect(decision.route).toBe('fast')
  })

  test('self-analysis wording cannot trigger the legacy deep adaptive class', () => {
    const plan = classifyExecution(user('Make a self-analysis and tell me if you are ready to manage businesses.'))
    expect(plan.executionClass).toBe('fast')
    expect(plan.timeoutMs).toBe(30000)
  })

  test('claim-aware quality allows internal architecture statements without live evidence', () => {
    const result = evaluateCeoQuality({
      objective: 'What architecture capabilities are implemented?',
      content: 'Architecturally, Agent007 is designed with governed CEO execution contracts and a persistent memory layer. Live business outcomes are not yet proven.',
      path: 'fast',
      externalExecutionSucceeded: true,
      evidenceScope: 'internal_state',
    })
    expect(result.decision).toBe('PASS')
    expect(result.checks.evidenceDiscipline).toBe(true)
    expect(result.claimScopes).toContain('internal_state')
    expect(result.evidenceState).toBe('LIVE_EXECUTED')
  })

  test('claim-aware quality rejects a positive live claim under internal-only evidence', () => {
    const result = evaluateCeoQuality({
      objective: 'How are you doing?',
      content: 'The current production deployment is verified and serving traffic.',
      path: 'fast',
      externalExecutionSucceeded: true,
      evidenceScope: 'internal_state',
    })
    expect(result.decision).not.toBe('PASS')
    expect(result.checks.evidenceDiscipline).toBe(false)
  })

  test('generic evidence cannot satisfy a positive live claim without a live scope', () => {
    const result = evaluateCeoQuality({
      objective: 'What is your current production status?',
      content: 'The current production runtime is verified.',
      path: 'fast',
      externalExecutionSucceeded: true,
      evidenceProvided: true,
    })
    expect(result.decision).not.toBe('PASS')
    expect(result.checks.evidenceDiscipline).toBe(false)
  })

  test('fresh live evidence passes while stale and future live evidence fail', () => {
    const now = Date.now()
    const fresh = evaluateCeoQuality({
      objective: 'What is your current production status?',
      content: 'The current production runtime is verified.',
      path: 'fast',
      externalExecutionSucceeded: true,
      evidenceScope: 'live_system',
      evidenceFreshness: { observedAt: now, maxAgeMs: 60_000 },
    })
    expect(fresh.decision).toBe('PASS')
    expect(fresh.evidenceState).toBe('LIVE_VERIFIED')

    const stale = evaluateCeoQuality({
      objective: 'What is your current production status?',
      content: 'The current production runtime is verified.',
      path: 'fast',
      externalExecutionSucceeded: true,
      evidenceScope: 'live_system',
      evidenceFreshness: { observedAt: now - 61_000, maxAgeMs: 60_000 },
    })
    expect(stale.decision).not.toBe('PASS')
    expect(stale.checks.evidenceDiscipline).toBe(false)

    const future = evaluateCeoQuality({
      objective: 'What is your current production status?',
      content: 'The current production runtime is verified.',
      path: 'fast',
      externalExecutionSucceeded: true,
      evidenceScope: 'live_system',
      evidenceFreshness: { observedAt: now + 1_000, maxAgeMs: 60_000 },
    })
    expect(future.decision).not.toBe('PASS')
    expect(future.checks.evidenceDiscipline).toBe(false)
  })

  test('external claims require explicit external evidence and freshness', () => {
    const content = 'According to the latest market report, competitors are offering similar executive software products.'
    const missingScope = evaluateCeoQuality({
      objective: 'What does the latest market report say about competitors?',
      content,
      path: 'fast',
      externalExecutionSucceeded: true,
      evidenceProvided: true,
    })
    expect(missingScope.decision).not.toBe('PASS')
    expect(missingScope.checks.evidenceDiscipline).toBe(false)

    const missingFreshness = evaluateCeoQuality({
      objective: 'What does the latest market report say about competitors?',
      content,
      path: 'fast',
      externalExecutionSucceeded: true,
      evidenceScope: 'external_web',
    })
    expect(missingFreshness.decision).not.toBe('PASS')
    expect(missingFreshness.checks.evidenceDiscipline).toBe(false)

    const now = Date.now()
    const fresh = evaluateCeoQuality({
      objective: 'What does the latest market report say about competitors?',
      content,
      path: 'fast',
      externalExecutionSucceeded: true,
      evidenceScope: 'external_web',
      evidenceFreshness: { observedAt: now, maxAgeMs: 300_000 },
    })
    expect(fresh.decision).toBe('PASS')
    expect(fresh.claimScopes).toContain('external_web')
    expect(fresh.claimScopes).not.toContain('live_system')
  })

  test('mixed internal and live claims require mixed fresh evidence', () => {
    const now = Date.now()
    const content = 'Architecturally, Agent007 is implemented with governed execution contracts. The current production runtime is verified.'
    const wrongScope = evaluateCeoQuality({
      objective: 'How is the current architecture and production runtime?',
      content,
      path: 'fast',
      externalExecutionSucceeded: true,
      evidenceScope: 'internal_state',
      evidenceFreshness: { observedAt: now, maxAgeMs: 60_000 },
    })
    expect(wrongScope.checks.evidenceDiscipline).toBe(false)

    const mixed = evaluateCeoQuality({
      objective: 'How is the current architecture and production runtime?',
      content,
      path: 'fast',
      externalExecutionSucceeded: true,
      evidenceScope: 'mixed',
      evidenceFreshness: { observedAt: now, maxAgeMs: 60_000 },
    })
    expect(mixed.decision).toBe('PASS')
    expect(mixed.claimScopes).toEqual(expect.arrayContaining(['internal_state', 'live_system']))
    expect(mixed.evidenceState).toBe('LIVE_VERIFIED')
  })

  test('negative evidence statements do not become unsupported positive claims', () => {
    const result = evaluateCeoQuality({
      objective: 'Are you ready to manage businesses?',
      content: 'I am not yet proven for unsupervised business ownership, and sustained customer and revenue outcomes remain unverified.',
      path: 'fast',
      externalExecutionSucceeded: true,
      evidenceScope: 'internal_state',
    })
    expect(result.checks.evidenceDiscipline).toBe(true)
  })

  test('critical answers require evidence even without a detected live or external phrase', () => {
    const result = evaluateCeoQuality({
      objective: 'Approve the mission decision.',
      content: '# Decision\n\nApprove the mission decision.\n\n- Action: approve\n- Risk: controlled\n- Evidence: unavailable',
      path: 'critical',
      externalExecutionSucceeded: true,
      reviewed: true,
      evidenceScope: 'none',
    })
    expect(result.decision).not.toBe('PASS')
    expect(result.checks.evidenceDiscipline).toBe(false)
  })

  test('executive readiness reaches governed operational capability at Level B', () => {
    const readiness = synthesizeExecutiveReadiness({
      operationalCapabilityVerified: true,
      liveExecutionVerified: false,
      productionTrafficVerified: false,
      repeatableBusinessOutcomesVerified: false,
      sustainedAutonomyVerified: false,
    })
    expect(readiness.level).toBe('B')
    expect(readiness.label).toBe('Governed operational capability')
  })

  test('executive readiness remains conservative without operational proof', () => {
    const readiness = synthesizeExecutiveReadiness({
      operationalCapabilityVerified: false,
      liveExecutionVerified: false,
      productionTrafficVerified: false,
      repeatableBusinessOutcomesVerified: false,
      sustainedAutonomyVerified: false,
    })
    expect(readiness.level).toBe('A')
    expect(readiness.label).toBe('Architectural capability')
    expect(readiness.notProven).toContain('not established')
  })

  test('executive readiness advances only with explicitly supplied fresh evidence', () => {
    const now = Date.now()
    const live = synthesizeExecutiveReadiness({
      operationalCapabilityVerified: true,
      liveExecutionVerified: true,
      productionTrafficVerified: true,
      repeatableBusinessOutcomesVerified: false,
      sustainedAutonomyVerified: false,
      observedAt: now,
      maxEvidenceAgeMs: 60_000,
      now,
    })
    expect(live.level).toBe('C')

    const outcomes = synthesizeExecutiveReadiness({
      operationalCapabilityVerified: true,
      liveExecutionVerified: true,
      productionTrafficVerified: true,
      repeatableBusinessOutcomesVerified: true,
      sustainedAutonomyVerified: false,
      observedAt: now,
      maxEvidenceAgeMs: 60_000,
      now,
    })
    expect(outcomes.level).toBe('D')

    const stale = synthesizeExecutiveReadiness({
      operationalCapabilityVerified: true,
      liveExecutionVerified: true,
      productionTrafficVerified: true,
      repeatableBusinessOutcomesVerified: false,
      sustainedAutonomyVerified: false,
      observedAt: now - 61_000,
      maxEvidenceAgeMs: 60_000,
      now,
    })
    expect(stale.level).toBe('B')
  })

  test('executive readiness requires sustained autonomy in addition to outcomes for Level E', () => {
    const now = Date.now()
    const e = synthesizeExecutiveReadiness({
      operationalCapabilityVerified: true,
      liveExecutionVerified: true,
      productionTrafficVerified: true,
      repeatableBusinessOutcomesVerified: true,
      sustainedAutonomyVerified: true,
      observedAt: now,
      maxEvidenceAgeMs: 60_000,
      now,
    })
    expect(e.level).toBe('E')
    expect(e.label).toBe('Sustained autonomy')
  })

  test('the exact original 5–10 minute incident stays on the bounded path', () => {
    const exact = 'Hows it going? make a self-analysis and tell me if you are ready to manage businesses?'
    const decision = preRouteCeoRequest(user(exact))
    const execution = classifyExecution(user(exact), classifyCeoSelfReflection(exact))
    expect(decision.executionContract.intent).toBe('self_assessment')
    expect(decision.executionContract.selfReflectionKind).toBe('readiness_assessment')
    expect(decision.route).toBe('fast')
    expect(execution.executionClass).toBe('fast')
    expect(decision.executionContract.latencyBudgetMs).toBeLessThanOrEqual(30000)
  })
})
