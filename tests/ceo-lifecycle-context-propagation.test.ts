import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dir, '..')
const source = readFileSync(join(ROOT, 'src/lib/ceo-cognitive-lifecycle.ts'), 'utf-8')

describe('Deep integration audit: guardian/world-model context must reach every generation stage, not just the primary one', () => {
  test('the clarify path includes guardianMessages -- a risk detected by Guardian must not be silently dropped just because the response happens to be a clarifying question', () => {
    const clarifyLine = source.split('\n').find((line) => line.includes("action === 'clarify'"))
    const clarifyCallLine = source.split('\n').find((line) => line.includes('Ask the minimum necessary natural clarification'))
    expect(clarifyLine).toBeDefined()
    expect(clarifyCallLine).toContain('...guardianMessages')
  })

  test('the independent-review stage includes both worldModelMessages and guardianMessages, not only the primary generation', () => {
    const reviewLine = source.split('\n').find((line) => line.includes('independent verification reviewer'))
    expect(reviewLine).toContain('...worldModelMessages')
    expect(reviewLine).toContain('...guardianMessages')
  })

  test('the synthesis stage includes both worldModelMessages and guardianMessages', () => {
    const synthesisLine = source.split('\n').find((line) => line.includes('final executive synthesizer'))
    expect(synthesisLine).toContain('...worldModelMessages')
    expect(synthesisLine).toContain('...guardianMessages')
  })

  test('the quality-gate escalation stage includes both worldModelMessages and guardianMessages -- this is the repair path for a response that already failed quality once, exactly where risk awareness matters most', () => {
    const escalationLine = source.split('\n').find((line) => line.includes('escalation reviewer'))
    expect(escalationLine).toContain('...worldModelMessages')
    expect(escalationLine).toContain('...guardianMessages')
  })

  test('the multi-pass refinement and semantic-repair stages already correctly use the full primaryMessages array, confirmed unaffected by this fix', () => {
    const refinementLine = source.split('\n').find((line) => line.includes('...primaryMessages') && line.includes('buildRefinementPrompt'))
    const repairLine = source.split('\n').find((line) => line.includes('...primaryMessages') && line.includes('renderSemanticRepairPrompt'))
    expect(refinementLine).toBeDefined()
    expect(repairLine).toBeDefined()
  })
})
