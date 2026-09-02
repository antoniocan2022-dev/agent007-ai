import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dir, '..')

describe('Phase 10 Operator Intelligence wired into the live lifecycle', () => {
  test('an execute responseAction is genuinely connected to the operator plan and canClaimExecution, not merely a soft prompt reminder', () => {
    const source = readFileSync(join(ROOT, 'src/lib/ceo-cognitive-lifecycle.ts'), 'utf-8')
    expect(source).toContain('buildCeoOperatorPlan')
    expect(source).toContain('canClaimExecution')
    expect(source).toMatch(/responseAction === 'execute'/)
    // The constraint must be conditioned on the real result, not always appended regardless.
    expect(source).toMatch(/operatorPlan\s*&&\s*!canClaimExecution\(operatorPlan\)/)
  })
})
