import { describe, expect, test } from 'bun:test'
import { composeCeoResponse, sanitizeCeoContentForQualityGate } from '@/lib/ceo-response-composer'
import { evaluateCeoQuality } from '@/lib/ceo-response-quality-gate'

const passingQuality = {
  decision: 'PASS' as const,
  evidenceState: 'NOT_APPLICABLE' as const,
  verificationStatus: 'NOT_REQUIRED' as const,
  checks: { nonEmpty: true, contractValid: true, objectiveCoverage: true, internalConsistency: true, evidenceDiscipline: true, actionableStructure: true },
  claimScopes: [] as string[],
  reasons: [] as string[],
}

describe('Architectural fix: the quality gate judges the sanitized, user-facing content instead of the pre-sanitization draft', () => {
  test('sanitizeCeoContentForQualityGate produces exactly the string composeCeoResponse delivers to the user, so the gate never judges content the user will not see', () => {
    const raw = 'My read is that we can still move this forward. 1. [ceo_recommendation] ceo_recommendation_x: {"schemaVersion":1,"correlationId":"abc"}\n\nBased on that, here is my real recommendation about your business strategy.'
    const delivered = composeCeoResponse({ content: raw, evidenceState: 'NOT_APPLICABLE', quality: passingQuality, degraded: false, conversational: true })
    const judged = sanitizeCeoContentForQualityGate(raw)
    expect(judged).toBe(delivered)
    expect(judged).not.toContain('ceo_recommendation')
    expect(judged).toContain('real recommendation about your business strategy')
  })

  test('a real answer padded by a long structured internal artifact no longer earns a structural pass from its inflated raw length -- the gate now sees the short, artifact-free text the user actually receives', () => {
    const objective = 'What is our current pricing strategy?'
    const raw = 'Our pricing is tiered.\n\n1. [ceo_recommendation] ceo_recommendation_x: {"schemaVersion":1,"correlationId":"abc","objective":"filler filler filler filler filler filler filler filler filler filler filler filler"}'
    const rawQuality = evaluateCeoQuality({ objective, content: raw, path: 'full', intent: 'analysis', reviewed: false, externalExecutionSucceeded: true })
    const sanitizedQuality = evaluateCeoQuality({ objective, content: sanitizeCeoContentForQualityGate(raw), path: 'full', intent: 'analysis', reviewed: false, externalExecutionSucceeded: true })

    // Judging the raw draft, the bullet marker and embedded JSON make the response look structurally sufficient.
    expect(rawQuality.checks.actionableStructure).toBe(true)
    // Judging the sanitized text the user actually receives, the real answer is too short and unstructured to pass -- exposing the gap the raw-content evaluation was hiding.
    expect(sanitizedQuality.checks.actionableStructure).toBe(false)
    expect(sanitizeCeoContentForQualityGate(raw)).not.toContain('ceo_recommendation')
  })

  test('a response that leaks an internal artifact token outside the soft-pass forbidden-failure set is still evaluated against its gutted final text, not silently rescued by the raw draft looking fine', () => {
    const objective = 'Can we keep going with this?'
    const raw = 'Sure, we can keep going with this. [continuous_loop_trace] continuous_loop:continuous_loop_abc: {"schemaVersion":1,"loopId":"continuous_loop_abc","currentStage":"PERCEIVE"}'
    const sanitized = sanitizeCeoContentForQualityGate(raw)
    expect(sanitized).not.toContain('continuous_loop_trace')

    const rawQuality = evaluateCeoQuality({ objective, content: raw, path: 'fast', intent: 'conversation', reviewed: false, externalExecutionSucceeded: true })
    const sanitizedQuality = evaluateCeoQuality({ objective, content: sanitized, path: 'fast', intent: 'conversation', reviewed: false, externalExecutionSucceeded: true })

    // The raw draft is correctly flagged as leaking, same as before this fix -- it must not PASS.
    expect(rawQuality.decision).not.toBe('PASS')
    // Judged post-sanitization, the actually-delivered text has no leakage left to flag.
    expect(sanitized).toBe('Sure, we can keep going with this.')
  })
})
