import { describe, expect, test } from 'bun:test'
import { assessCeoCuriosity } from '@/lib/ceo-curiosity'
import { buildCeoOperatorPlan, canClaimExecution } from '@/lib/ceo-operator-intelligence'

const context = { currentMessage: 'What is our competitor doing right now?', meaning: 'What is our competitor doing right now?', intentHint: 'analysis', semanticInterpretation: { suggestedIntent: undefined } } as any
const contract = { toolRequirement: 'possible', evidenceRequirement: 'possible', responseAction: 'answer' } as any

describe('Strengthened curiosity engine', () => {
  test('flags investigation as needed when no world model is supplied and a material external signal is present', () => {
    const decision = assessCeoCuriosity(context, contract)
    expect(decision.investigate).toBe(true)
    expect(decision.materialUnknowns.length).toBeGreaterThan(0)
  })

  test('does not redundantly flag investigation when the world model already shows external evidence was acquired', () => {
    const decision = assessCeoCuriosity(context, contract, { external: { data: { evidenceState: 'available' } } } as any)
    expect(decision.investigate).toBe(false)
    expect(decision.reason).toContain('already been acquired')
  })
})

const executionContract = { intent: 'conversation', operation: 'none', executionRequirement: 'llm_only', toolRequired: false, evidenceRequirement: 'none' } as any

describe('Operator Intelligence: world and curiosity are genuinely load-bearing, not accepted-and-ignored', () => {
  test('an unresolved open loop in the world model blocks execution even with approval and verified evidence', () => {
    const plan = buildCeoOperatorPlan({ contract: executionContract, responseAction: 'execute', objective: 'x', world: { conversation: { data: { openLoops: ['What is the rollback plan?'] } }, external: { data: { evidenceState: 'available' } } } as any, approved: true, executionEvidence: true, verificationState: 'LIVE_VERIFIED' })
    expect(plan.status).toBe('blocked')
    expect(canClaimExecution(plan)).toBe(false)
    expect(plan.tasks[0]?.dependencies).toContain('unresolved open question in this conversation')
  })

  test('an unaddressed material unknown from curiosity blocks execution the same way', () => {
    const plan = buildCeoOperatorPlan({ contract: executionContract, responseAction: 'execute', objective: 'x', world: { conversation: { data: { openLoops: [] } }, external: { data: { evidenceState: 'none' } } } as any, curiosity: { investigate: true, reason: 'x', materialUnknowns: ['Current competitor pricing'] }, approved: true, executionEvidence: true, verificationState: 'LIVE_VERIFIED' })
    expect(plan.status).toBe('blocked')
    expect(canClaimExecution(plan)).toBe(false)
    expect(plan.tasks[0]?.dependencies[0]).toContain('Current competitor pricing')
  })

  test('a genuinely clean case -- no open loops, no unknowns, approved, verified -- still reaches verified status', () => {
    const plan = buildCeoOperatorPlan({ contract: executionContract, responseAction: 'execute', objective: 'x', world: { conversation: { data: { openLoops: [] } }, external: { data: { evidenceState: 'available' } } } as any, curiosity: { investigate: false, reason: 'x', materialUnknowns: [] }, approved: true, executionEvidence: true, verificationState: 'LIVE_VERIFIED' })
    expect(plan.status).toBe('verified')
    expect(canClaimExecution(plan)).toBe(true)
  })
})
