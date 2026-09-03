import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { detectToolWeakness, detectConversationalWeakness, reviewEvolutionProposal, renderEvolutionImplementationChecklist, type EvolutionProposal } from '@/lib/ceo-evolution-proposal'

const ROOT = join(import.meta.dir, '..')

describe('Phase 21: Self-Optimization -- pattern detection over real evidence only', () => {
  test('insufficient observations produce no proposal, avoiding action on noise', () => {
    const proposal = detectToolWeakness({ toolId: 'web_search', capability: 'research', observations: 3, successRate: 0, avgLatencyMs: 5000, reliabilityAdjustment: -0.1, confidence: 20 })
    expect(proposal).toBeNull()
  })

  test('a low failure rate, even with enough observations, produces no proposal', () => {
    const proposal = detectToolWeakness({ toolId: 'web_search', capability: 'research', observations: 20, successRate: 90, avgLatencyMs: 5000, reliabilityAdjustment: 0.08, confidence: 80 })
    expect(proposal).toBeNull()
  })

  test('a genuine, sustained failure rate with enough observations produces a real proposal, traceable to specific numbers', () => {
    const proposal = detectToolWeakness({ toolId: 'web_search', capability: 'research', observations: 12, successRate: 30, avgLatencyMs: 5000, reliabilityAdjustment: -0.09, confidence: 70 })
    expect(proposal).not.toBeNull()
    expect(proposal!.observedWeakness).toContain('70%')
    expect(proposal!.observedWeakness).toContain('12 observed uses')
    expect(proposal!.status).toBe('proposed')
  })

  test('a proposal is only ever a recommendation to investigate, never an instruction to change anything automatically', () => {
    const proposal = detectToolWeakness({ toolId: 'web_search', capability: 'research', observations: 12, successRate: 30, avgLatencyMs: 5000, reliabilityAdjustment: -0.09, confidence: 70 })
    expect(proposal!.proposedChange).toContain('not an instruction to remove or replace anything automatically')
  })

  test('below-threshold incident frequency produces no conversational-health proposal', () => {
    const proposal = detectConversationalWeakness({ windowHours: 24, incidentCount: 6, byInputClass: { correction: 3 }, byInvariant: {}, mostFrequentClass: 'correction' })
    expect(proposal).toBeNull()
  })

  test('a genuinely recurring incident class produces a real, traceable proposal', () => {
    const proposal = detectConversationalWeakness({ windowHours: 24, incidentCount: 12, byInputClass: { correction: 7 }, byInvariant: {}, mostFrequentClass: 'correction' })
    expect(proposal).not.toBeNull()
    expect(proposal!.observedWeakness).toContain('7 times')
  })
})

describe('Phase 22: Governed Self-Evolution -- every safety boundary', () => {
  const genuineWeakness: EvolutionProposal = detectToolWeakness({ toolId: 'web_search', capability: 'research', observations: 12, successRate: 30, avgLatencyMs: 5000, reliabilityAdjustment: -0.09, confidence: 70 })!

  test('cannot review a proposal without a genuine, non-empty reviewer name', () => {
    expect(() => reviewEvolutionProposal(genuineWeakness, { reviewedBy: '', riskAcknowledged: true, approved: true })).toThrow()
    expect(() => reviewEvolutionProposal(genuineWeakness, { reviewedBy: '   ', riskAcknowledged: true, approved: true })).toThrow()
  })

  test('cannot approve a proposal without explicitly acknowledging the stated risk', () => {
    expect(() => reviewEvolutionProposal(genuineWeakness, { reviewedBy: 'Antonio', riskAcknowledged: false, approved: true })).toThrow()
  })

  test('a rejected review is a legitimate, non-throwing outcome', () => {
    const rejected = reviewEvolutionProposal(genuineWeakness, { reviewedBy: 'Antonio', riskAcknowledged: true, approved: false, reviewNotes: 'Not a real problem, expected variance.' })
    expect(rejected.status).toBe('rejected')
  })

  test('cannot render an implementation checklist for anything other than a genuinely approved proposal', () => {
    expect(() => renderEvolutionImplementationChecklist(genuineWeakness)).toThrow()
    const rejected = reviewEvolutionProposal(genuineWeakness, { reviewedBy: 'Antonio', riskAcknowledged: true, approved: false })
    expect(() => renderEvolutionImplementationChecklist(rejected)).toThrow()
  })

  test('a genuinely approved proposal produces a plain-text checklist, never an executable action, and explicitly states it implements nothing', () => {
    const approved = reviewEvolutionProposal(genuineWeakness, { reviewedBy: 'Antonio', riskAcknowledged: true, approved: true, reviewNotes: 'Investigating.' })
    const checklist = renderEvolutionImplementationChecklist(approved)
    expect(typeof checklist).toBe('string')
    expect(checklist).toContain('Approved by: Antonio')
    expect(checklist).toContain('does not implement anything')
    expect(checklist).toContain('separate, explicit implementation step')
  })

  test('this module is genuinely isolated from every automatic execution path -- confirmed against the real source, not assumed', () => {
    const route = readFileSync(join(ROOT, 'src/app/api/agent/route.ts'), 'utf-8')
    const lifecycle = readFileSync(join(ROOT, 'src/lib/ceo-cognitive-lifecycle.ts'), 'utf-8')
    expect(route).not.toContain('ceo-evolution-proposal')
    expect(lifecycle).not.toContain('ceo-evolution-proposal')
  })

  test('no function in this module writes to any file, executes code, or calls any process/exec/fs API', () => {
    const source = readFileSync(join(ROOT, 'src/lib/ceo-evolution-proposal.ts'), 'utf-8')
    expect(source).not.toMatch(/writeFile|execSync|spawn|require\(['"]fs['"]\)|import.*from ['"]fs['"]|eval\(/)
  })
})
