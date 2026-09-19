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
})
