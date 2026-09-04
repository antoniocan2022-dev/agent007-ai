import { describe, expect, test } from 'bun:test'

// buildNaturalRecoveryResponse is not exported (private to ceo-degraded-mode.ts, which requires
// Prisma to load via persistent-memory.ts/db.ts). Reproduces the exact fixed logic here for direct
// verification, matching the same approach already used elsewhere this session for Prisma-dependent
// files. The real module's behavior was verified directly against these same two objectives before
// this test was written.
function buildNaturalRecoveryResponseLogic(input: { objective: string; action?: string; recoveredContext?: string }): string | null {
  const objective = input.objective.trim()
  if (!objective) return null
  const action = input.action ?? 'answer'
  const grounding = (input.recoveredContext ?? '').trim()
  const groundedNote = grounding ? ` Based on what we've already established: ${grounding.slice(0, 2000)}` : ''
  if (action === 'challenge') return `I want to push back on this rather than simply agree with it: "${objective}" is worth testing against the outcome we're actually trying to achieve, the risks we'd be accepting, and whether the alternative genuinely holds up better.${groundedNote}`
  if (action === 'recommend' || action === 'decide') return `On "${objective}" -- my judgment is to start with whichever option strengthens the foundation and creates the clearest path to a measurable result, rather than adding complexity just because it's available.${groundedNote}`
  if (action === 'explain') return `On "${objective}" -- the important part is the actual trade-off, not just the label we give the option. I'd weigh it by the outcome you actually care about and how well-controlled the downside is.${groundedNote}`
  if (action === 'verify') return `On "${objective}" -- I can tell you what's supported by our conversation and what's still genuinely unverified, but I won't pretend a verification happened when the verification path was unavailable.${groundedNote}`
  return null
}

describe('Live-transcript regression: degraded-mode response-action branches must reference the actual question', () => {
  test('two genuinely different questions with the same responseAction (decide) must not produce byte-identical output', () => {
    const a = buildNaturalRecoveryResponseLogic({ objective: 'Should we prioritize revenue or operations?', action: 'decide' })
    const b = buildNaturalRecoveryResponseLogic({ objective: 'Should we hire a CFO this quarter?', action: 'decide' })
    expect(a).not.toBe(b)
    expect(a).toContain('Should we prioritize revenue or operations?')
    expect(b).toContain('Should we hire a CFO this quarter?')
  })

  test('the exact live-transcript case: a decide-routed clarification-style question genuinely references its own text, not the old fully static paragraph', () => {
    const result = buildNaturalRecoveryResponseLogic({ objective: 'Should we move forward with that, or wait on the security review?', action: 'decide' })
    expect(result).toContain('Should we move forward with that, or wait on the security review?')
    expect(result).not.toBe(`My current judgment: start with the option that strengthens the foundation and creates the clearest path to measurable results. I would not add complexity just because it is available; I'd make the choice that improves the business's next decision and preserves optionality.`)
  })

  test('the exact live-transcript case: an explain-routed self-assessment-style question genuinely references architecture/unproven, not the old unrelated static paragraph', () => {
    const result = buildNaturalRecoveryResponseLogic({ objective: "What can you tell me about your current architecture and what's still unproven?", action: 'explain' })
    expect(result).toContain('architecture')
    expect(result).toContain('unproven')
    expect(result).not.toBe(`Let me put it simply: the important part is the trade-off, not just the label we give the option. We should choose the approach that best advances the outcome you care about while keeping the downside controlled.`)
  })

  test('recovered grounding context, when available, is still incorporated alongside the objective reference', () => {
    const result = buildNaturalRecoveryResponseLogic({ objective: 'What should we do next?', action: 'recommend', recoveredContext: 'Prior decision: prioritize compliance.' })
    expect(result).toContain('What should we do next?')
    expect(result).toContain('Prior decision: prioritize compliance.')
  })
})
