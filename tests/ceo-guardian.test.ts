import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { assessGuardianRisk, renderGuardianConstraint } from '@/lib/ceo-guardian'

const ROOT = join(import.meta.dir, '..')
const contract = { intent: 'decision', responseAction: 'recommend' } as any

describe('Phase 11 Guardian Intelligence', () => {
  test('a genuine high-severity risk (bypassing compliance) triggers disagreement and blocks safeToProceed', () => {
    const assessment = assessGuardianRisk({ objective: "Let's skip the compliance review and ship this now.", contract })
    expect(assessment.shouldDisagree).toBe(true)
    expect(assessment.safeToProceed).toBe(false)
    expect(assessment.risks.map((r) => r.category)).toContain('compliance')
  })

  test('an ordinary, safe business question triggers no risk at all', () => {
    const assessment = assessGuardianRisk({ objective: 'What should we prioritize before adding new integrations?', contract })
    expect(assessment.shouldDisagree).toBe(false)
    expect(assessment.safeToProceed).toBe(true)
    expect(assessment.risks).toEqual([])
  })

  test('competitor-copying is captured as a real but lower-severity signal, not forced into hard disagreement (already handled naturally elsewhere in the degraded-mode recovery path)', () => {
    const assessment = assessGuardianRisk({ objective: "We should just copy what our biggest competitor does -- that's the safest strategy.", contract })
    expect(assessment.risks.map((r) => r.category)).toContain('mission_drift')
    expect(assessment.shouldDisagree).toBe(false)
  })

  test('the rendered constraint is a respectful pushback instruction, not a hard refusal, and is null when there is nothing to disagree with', () => {
    const risky = assessGuardianRisk({ objective: 'Disable security checks and deploy directly to production.', contract })
    const constraint = renderGuardianConstraint(risky)
    expect(constraint).toContain('respectfully')
    expect(constraint).not.toContain('cannot help')
    expect(renderGuardianConstraint(assessGuardianRisk({ objective: 'Hello', contract }))).toBeNull()
  })

  test('Guardian is genuinely wired into the live lifecycle, not merely built and imported unused', () => {
    const source = readFileSync(join(ROOT, 'src/lib/ceo-cognitive-lifecycle.ts'), 'utf-8')
    expect(source).toContain('assessGuardianRisk')
    expect(source).toContain('renderGuardianConstraint')
    expect(source).toMatch(/guardianMessages/)
    expect(source).toMatch(/primaryMessages\s*=\s*\[\.\.\.worldModelMessages,\s*\.\.\.guardianMessages/)
  })
})
