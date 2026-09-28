import { describe, expect, test } from 'bun:test'
import { classifyOperationalExecution } from '@/lib/ceo-execution-handoff'

describe('ACT -> VERIFY -> RESPOND execution handoff', () => {
  test('does not promote an action that only returned ok:true without verification', () => {
    const handoff = classifyOperationalExecution({
      executionStatus: 'completed',
      steps: [{
        toolName: 'send_email',
        toolResult: { ok: true },
        verification: { verified: false },
      }],
    })
    expect(handoff.externalExecutionSucceeded).toBe(false)
    expect(handoff.evidenceScope).toBe('internal_state')
    expect(handoff.evidenceFreshness).toBeUndefined()
    expect(handoff.verification.unverifiedActionSteps).toBe(1)
  })

  test('promotes a verified action to live-system evidence', () => {
    const handoff = classifyOperationalExecution({
      executionStatus: 'completed',
      steps: [{
        toolName: 'send_email',
        toolResult: { ok: true },
        verification: { verified: true },
      }],
    })
    expect(handoff.externalExecutionSucceeded).toBe(true)
    expect(handoff.evidenceScope).toBe('live_system')
    expect(handoff.evidenceFreshness).toBeDefined()
    expect(handoff.verification.verifiedActionSteps).toBe(1)
  })

  test('does not confuse read/research success with completed action', () => {
    const handoff = classifyOperationalExecution({
      executionStatus: 'completed',
      steps: [{
        toolName: 'web_search',
        toolResult: { ok: true },
        verification: { verified: true },
      }],
    })
    expect(handoff.externalExecutionSucceeded).toBe(false)
    expect(handoff.evidenceScope).toBe('internal_state')
    expect(handoff.verification.researchSteps).toBe(1)
    expect(handoff.verification.knownActionSteps).toBe(0)
  })

  test('treats successful internal manage actions as live system state', () => {
    const handoff = classifyOperationalExecution({
      executionStatus: 'completed',
      steps: [{
        toolName: 'manage_action',
        toolResult: { ok: true },
      }],
    })
    expect(handoff.externalExecutionSucceeded).toBe(true)
    expect(handoff.evidenceScope).toBe('live_system')
  })

  test('treats a completed mission pipeline as governed execution evidence', () => {
    const handoff = classifyOperationalExecution({
      executionStatus: 'completed',
      steps: [{
        toolName: 'mission_pipeline',
        toolResult: { ok: true },
      }],
    })
    expect(handoff.externalExecutionSucceeded).toBe(true)
    expect(handoff.evidenceScope).toBe('live_system')
  })

  test('an unverified action cannot be masked by a successful manage action', () => {
    const handoff = classifyOperationalExecution({
      executionStatus: 'completed',
      steps: [
        { toolName: 'manage_action', toolResult: { ok: true } },
        { toolName: 'send_email', toolResult: { ok: true }, verification: { verified: false } },
      ],
    })
    expect(handoff.externalExecutionSucceeded).toBe(false)
    expect(handoff.evidenceScope).toBe('internal_state')
    expect(handoff.verification.hasUnverifiedAction).toBe(true)
  })

  test('never promotes a failed or partial execution', () => {
    const partial = classifyOperationalExecution({
      executionStatus: 'partial',
      steps: [{ toolName: 'send_email', toolResult: { ok: true }, verification: { verified: true } }],
    })
    expect(partial.externalExecutionSucceeded).toBe(false)
    expect(partial.evidenceScope).toBe('internal_state')
  })

  test('never promotes a failed execution', () => {
    const handoff = classifyOperationalExecution({
      executionStatus: 'failed',
      steps: [{
        toolName: 'send_email',
        toolResult: { ok: true },
        verification: { verified: true },
      }],
    })
    expect(handoff.externalExecutionSucceeded).toBe(false)
    expect(handoff.evidenceScope).toBe('internal_state')
  })

  // Production incident (2026-09-28): a live "run a full self-check and confirm the whole system is
  // healthy" was routed through the orchestrator's auto-diagnostics block, which made 4 real fetches
  // (health/capability-audit/team-performance/diagnose-llm) but never recorded them as a `steps` entry --
  // the model then correctly emitted <done/> with zero tool steps (per the ACT HANDOFF instruction
  // telling it the CEO response layer would synthesize the answer). With zero steps, evidenceScope
  // fell back to 'internal_state', so the CEO's honest "the system is currently healthy" answer was
  // rejected as an unverifiable live_system claim -- real, fresh evidence was gathered but discarded
  // before reaching the quality gate. diagnosticsEvidence closes that gap.
  test('a self-check with zero tracked tool steps still gets live-system evidence when fresh diagnostics were actually gathered', () => {
    const handoff = classifyOperationalExecution({
      executionStatus: 'completed',
      steps: [],
      diagnosticsEvidence: { gathered: true, observedAt: Date.now() },
    })
    expect(handoff.externalExecutionSucceeded).toBe(false)
    expect(handoff.evidenceScope).toBe('live_system')
    expect(handoff.evidenceFreshness).toBeDefined()
  })

  test('diagnosticsEvidence.gathered:false (every diagnostic fetch failed) does not fabricate live-system evidence', () => {
    const handoff = classifyOperationalExecution({
      executionStatus: 'completed',
      steps: [],
      diagnosticsEvidence: { gathered: false, observedAt: Date.now() },
    })
    expect(handoff.evidenceScope).toBe('internal_state')
    expect(handoff.evidenceFreshness).toBeUndefined()
  })

  test('stale diagnosticsEvidence (older than the 5-minute freshness window) does not promote evidence scope', () => {
    const handoff = classifyOperationalExecution({
      executionStatus: 'completed',
      steps: [],
      diagnosticsEvidence: { gathered: true, observedAt: Date.now() - 400_000 },
    })
    expect(handoff.evidenceScope).toBe('internal_state')
    expect(handoff.evidenceFreshness).toBeUndefined()
  })
})
