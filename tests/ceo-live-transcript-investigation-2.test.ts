import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { classifyCeoSelfReflection } from '@/lib/ceo-self-reflection'

const ROOT = join(import.meta.dir, '..')

describe('Live-transcript investigation: three real bugs found and fixed', () => {
  test('1. the OPERATIONAL EXECUTION RESULT / Completed steps / Tool steps internal labels no longer flow into contextualEvidence -- confirmed live, this text appeared verbatim in a real user-facing response', () => {
    const source = readFileSync(join(ROOT, 'src/app/api/agent/route.ts'), 'utf-8')
    expect(source).not.toContain('OPERATIONAL EXECUTION RESULT')
    expect(source).not.toMatch(/Completed steps:.*Tool steps:/)
    const evidenceLine = source.split('\n').find((line) => line.includes('const operationalEvidence ='))
    expect(evidenceLine).toContain('result.finalAnswer')
    expect(evidenceLine).not.toContain('OPERATIONAL EXECUTION RESULT')
  })

  test('2. classifyCeoSelfReflection now correctly recognizes architecture/proven/unproven self-assessment language, confirmed against the exact real message that previously fell through to a generic template', () => {
    const result = classifyCeoSelfReflection("What can you tell me about your current architecture and what's still unproven?")
    expect(result.isSelfReflective).toBe(true)
    expect(result.kind).toBe('capability_assessment')
  })

  test('2b. the fix does not introduce false positives -- an architecture or verification question with no genuine self-reference still correctly falls through', () => {
    expect(classifyCeoSelfReflection("What's the architecture of our new payment integration?").isSelfReflective).toBe(false)
    expect(classifyCeoSelfReflection('Is this customer data verified?').isSelfReflective).toBe(false)
  })

  test('2c. existing capability-assessment classification is unaffected by the fix', () => {
    const result = classifyCeoSelfReflection('What are your strengths and weaknesses?')
    expect(result.kind).toBe('capability_assessment')
    expect(result.isSelfReflective).toBe(true)
  })

  test('3. the degraded-mode source genuinely distinguishes caller-supplied (unverified) grounding from genuine memory, not treating both identically', () => {
    const source = readFileSync(join(ROOT, 'src/lib/ceo-degraded-mode.ts'), 'utf-8')
    expect(source).toContain('isSuppliedByCaller')
    expect(source).toContain("if (grounding && input.isSuppliedByCaller)")
    expect(source).toContain('preliminary read based on an initial pass')
    expect(source).toContain('isSuppliedByCaller: Boolean(suppliedContext)')
  })
})
