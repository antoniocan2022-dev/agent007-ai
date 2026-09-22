import { describe, expect, test } from 'bun:test'
import { assessStructuralQuality, type StructuralSourceModel } from '@/lib/ceo-structural-quality-gate'
import { evaluateCeoQuality } from '@/lib/ceo-response-quality-gate'

// Recommendation 3 (2026-09-20): "move the quality gate from lexical-relaxation toward the structural
// contract... claim coverage, contradiction preservation, source-vs-inference distinction -- this needs
// Phase 3's structured source model as an input." These tests verify the new module in isolation, then
// verify it actually changes evaluateCeoQuality's real PASS/ESCALATE decision when wired through (not
// just that the type-checks pass) -- the same "prove it end to end, not just on paper" discipline this
// session used throughout (see e.g. the runCanonicalLlmParallel bug caught while testing Recommendation 2).

function section(index: number, text: string): { sectionIndex: number; text: string } {
  return { sectionIndex: index, text }
}

describe('assessStructuralQuality: applicability', () => {
  test('is a pure no-op when no source model is supplied', () => {
    const result = assessStructuralQuality({ content: 'Any answer at all.' })
    expect(result.applicable).toBe(false)
    expect(result.claimCoverageOk).toBe(true)
    expect(result.contradictionPreserved).toBe(true)
    expect(result.sourceAttributionPresent).toBe(true)
    expect(result.sourceCoverageComplete).toBe(true)
  })

  test('is a pure no-op when the source model has no section extracts', () => {
    const sourceModel: StructuralSourceModel = { sectionCount: 3, sectionExtracts: [], synthesis: 'Synthesis.' }
    const result = assessStructuralQuality({ sourceModel, content: 'Any answer at all.' })
    expect(result.applicable).toBe(false)
  })
})

describe('assessStructuralQuality: claim coverage', () => {
  test('partial source coverage is exposed and does not masquerade as complete', () => {
    const sourceModel: StructuralSourceModel = {
      sectionCount: 4,
      sectionExtracts: [section(0, 'Revenue grew steadily'), section(1, 'Engineering shipped on time')],
      synthesis: 'Partial synthesis from the processed sections.',
      coverageComplete: false,
    }
    const result = assessStructuralQuality({ sourceModel, content: 'Revenue grew steadily and engineering shipped on time.' })
    expect(result.applicable).toBe(true)
    expect(result.sourceCoverageComplete).toBe(false)
    expect(result.claimCoverageOk).toBe(false)
  })


  function fiveSectionModel(): StructuralSourceModel {
    return {
      sectionCount: 5,
      sectionExtracts: [
        section(0, 'Revenue grew fourteen percent quarter over quarter driven by mid-market expansion subscriptions'),
        section(1, 'Engineering shipped analytics dashboard ahead of schedule completed billing migration smoothly'),
        section(2, 'Competitive landscape features aggressive new entrants cutting pricing on entry tier offerings'),
        section(3, 'Marketing research shows continued appetite integrations accounting software partnerships pipeline'),
        section(4, 'Infrastructure team completed failover testing security closed remaining external audit findings'),
      ],
      synthesis: 'A synthesis of all five sections covering revenue, engineering, competition, marketing, and infrastructure.',
    }
  }

  test('an answer engaging with only one section falls below the coverage minimum', () => {
    const sourceModel = fiveSectionModel()
    const content = 'Revenue grew fourteen percent quarter over quarter driven by mid-market expansion.'
    const result = assessStructuralQuality({ sourceModel, content })
    expect(result.applicable).toBe(true)
    expect(result.representedSectionCount).toBe(1)
    expect(result.claimCoverage).toBeCloseTo(0.2, 5)
    expect(result.claimCoverageOk).toBe(false)
  })

  test('partial source coverage cannot pass merely because every processed section is represented', () => {
    const sourceModel: StructuralSourceModel = {
      sectionCount: 4,
      sectionExtracts: [section(0, 'Revenue grew fourteen percent quarter over quarter'), section(1, 'Engineering shipped the dashboard ahead of schedule')],
      synthesis: 'Partial synthesis from two of four sections.',
      coverageComplete: false,
    }
    const result = assessStructuralQuality({ sourceModel, content: 'Revenue grew fourteen percent quarter over quarter, and engineering shipped the dashboard ahead of schedule.' })
    expect(result.representedSectionCount).toBe(2)
    expect(result.claimCoverage).toBe(0.5)
    expect(result.claimCoverageOk).toBe(false)
    expect(result.sourceCoverageComplete).toBe(false)
  })

  test('an answer drawing on a meaningful spread of sections clears the coverage minimum', () => {
    const sourceModel = fiveSectionModel()
    const content = 'Revenue grew fourteen percent this quarter. Engineering shipped the analytics dashboard ahead of schedule. Competitors cut pricing on entry tier offerings.'
    const result = assessStructuralQuality({ sourceModel, content })
    expect(result.representedSectionCount).toBeGreaterThanOrEqual(2)
    expect(result.claimCoverage).toBeGreaterThanOrEqual(0.25)
    expect(result.claimCoverageOk).toBe(true)
  })

  test('a completely unrelated answer represents zero sections', () => {
    const sourceModel = fiveSectionModel()
    const result = assessStructuralQuality({ sourceModel, content: 'The weather today is sunny with a light breeze from the west.' })
    expect(result.representedSectionCount).toBe(0)
    expect(result.claimCoverage).toBe(0)
    expect(result.claimCoverageOk).toBe(false)
  })
})

describe('assessStructuralQuality: contradiction preservation', () => {
  function contradictoryModel(): StructuralSourceModel {
    return {
      sectionCount: 2,
      sectionExtracts: [section(0, 'Section one reports Q3 revenue of four million dollars'), section(1, 'Section two reports Q3 revenue of five million dollars')],
      synthesis: 'The two sections report conflicting revenue figures for Q3 that could not be reconciled from the extraction notes alone.',
    }
  }

  test('flags the upstream contradiction when the synthesis notes one', () => {
    const result = assessStructuralQuality({ sourceModel: contradictoryModel(), content: 'Revenue for Q3 was strong.' })
    expect(result.contradictionFlaggedUpstream).toBe(true)
  })

  test('a final answer that silently picks one figure without acknowledging the conflict does not preserve it', () => {
    const result = assessStructuralQuality({ sourceModel: contradictoryModel(), content: 'Q3 revenue was five million dollars, driven by strong mid-market growth.' })
    expect(result.contradictionPreserved).toBe(false)
  })

  test('a final answer that acknowledges the discrepancy preserves it', () => {
    const result = assessStructuralQuality({ sourceModel: contradictoryModel(), content: 'The sources report conflicting Q3 revenue figures (four million vs. five million); this discrepancy could not be resolved from the available material.' })
    expect(result.contradictionPreserved).toBe(true)
  })

  test('no contradiction language in the synthesis means nothing to preserve, regardless of the answer', () => {
    const sourceModel: StructuralSourceModel = { sectionCount: 2, sectionExtracts: [section(0, 'Revenue grew steadily'), section(1, 'Engineering shipped on time')], synthesis: 'A straightforward synthesis with no discrepancies noted.' }
    const result = assessStructuralQuality({ sourceModel, content: 'Revenue grew steadily and engineering shipped on time.' })
    expect(result.contradictionFlaggedUpstream).toBe(false)
    expect(result.contradictionPreserved).toBe(true)
  })
})

describe('assessStructuralQuality: source-vs-inference distinction (advisory)', () => {
  const sourceModel: StructuralSourceModel = { sectionCount: 2, sectionExtracts: [section(0, 'Revenue grew steadily this quarter across segments')], synthesis: 'Synthesis.' }

  test('detects explicit source attribution language', () => {
    const result = assessStructuralQuality({ sourceModel, content: 'The report states that revenue grew steadily this quarter.' })
    expect(result.sourceAttributionPresent).toBe(true)
  })

  test('detects the model framing its own inference', () => {
    const result = assessStructuralQuality({ sourceModel, content: 'Based on this data, I would recommend continuing the current strategy.' })
    expect(result.sourceAttributionPresent).toBe(true)
  })

  test('a flat, undifferentiated answer has no attribution language', () => {
    const result = assessStructuralQuality({ sourceModel, content: 'Revenue grew steadily this quarter across segments.' })
    expect(result.sourceAttributionPresent).toBe(false)
  })
})

describe('evaluateCeoQuality: the structural model actually changes the real PASS/ESCALATE decision', () => {
  const objective = 'Summarize the key points of this quarterly report.'

  function fiveSectionModel(): StructuralSourceModel {
    return {
      sectionCount: 5,
      sectionExtracts: [
        section(0, 'Revenue grew fourteen percent quarter over quarter driven by mid-market expansion subscriptions renewals'),
        section(1, 'Engineering shipped analytics dashboard ahead of schedule completed billing migration smoothly customers'),
        section(2, 'Competitive landscape features aggressive new entrants cutting pricing on entry tier offerings margins'),
        section(3, 'Marketing research shows continued appetite integrations accounting software partnerships pipeline proposals'),
        section(4, 'Infrastructure team completed failover testing security closed remaining external audit findings regions'),
      ],
      synthesis: 'A synthesis of all five sections covering revenue, engineering, competition, marketing, and infrastructure.',
    }
  }

  // Deliberately reuses almost none of fiveSectionModel's own vocabulary -- a concise, accurate synthesis
  // legitimately paraphrases rather than quoting its source, which is exactly the scenario the
  // long-document incident (2026-09-19) found objectiveCoverage's raw lexical check couldn't handle. This
  // is the case claimCoverage is meant to replace it for: it checks engagement across the document's own
  // SECTIONS, not overlap with the objective's wording.
  const goodSynthesisAnswer = 'This quarter showed solid top-line growth from mid-market renewals, on-schedule delivery of new analytics tooling and a smooth billing migration, tighter pricing pressure from new competitors, active partnership discussions for accounting integrations, and completed infrastructure resilience testing with audit remediation finished.'

  test('a genuine synthesis that barely reuses the objective\'s own wording still passes coverage when a structural source model confirms it engages with most of the document', () => {
    const result = evaluateCeoQuality({ objective, content: goodSynthesisAnswer, path: 'full', intent: 'analysis', reviewed: false, externalExecutionSucceeded: true, comprehensionMode: 'deep_analysis', structuralSourceModel: fiveSectionModel() })
    expect(result.checks.objectiveCoverage).toBe(true)
    expect(result.structuralQuality?.applicable).toBe(true)
    expect(result.structuralQuality?.claimCoverageOk).toBe(true)
  })

  test('an answer that only engages with one section of a genuinely large document fails coverage even though it would have passed the old lexical-only check', () => {
    const narrowAnswer = 'Revenue grew fourteen percent quarter over quarter driven by mid-market expansion subscriptions renewals.'
    const result = evaluateCeoQuality({ objective, content: narrowAnswer, path: 'full', intent: 'analysis', reviewed: false, externalExecutionSucceeded: true, comprehensionMode: 'deep_analysis', structuralSourceModel: fiveSectionModel() })
    expect(result.structuralQuality?.applicable).toBe(true)
    expect(result.structuralQuality?.claimCoverageOk).toBe(false)
    expect(result.checks.objectiveCoverage).toBe(false)
  })

  test('a contradiction the source flagged but the answer silently drops forces ESCALATE, with the shared claim_consistency_failure reason', () => {
    const contradictoryModel: StructuralSourceModel = {
      sectionCount: 2,
      sectionExtracts: [section(0, 'Section one reports Q3 revenue of four million dollars driven by renewals'), section(1, 'Section two reports Q3 revenue of five million dollars driven by new business')],
      synthesis: 'The two sections report conflicting revenue figures for Q3 that could not be reconciled from the extraction notes alone.',
    }
    const silentAnswer = 'Q3 revenue was five million dollars, driven by strong new business momentum this quarter across segments.'
    const result = evaluateCeoQuality({ objective: 'What was our Q3 revenue?', content: silentAnswer, path: 'full', intent: 'analysis', reviewed: false, externalExecutionSucceeded: true, comprehensionMode: 'deep_analysis', structuralSourceModel: contradictoryModel })
    expect(result.decision).toBe('ESCALATE')
    expect(result.failureReason).toBe('claim_consistency_failure')
    expect(result.structuralQuality?.contradictionFlaggedUpstream).toBe(true)
    expect(result.structuralQuality?.contradictionPreserved).toBe(false)
  })

  test('the identical contradiction, acknowledged in the answer, does not force ESCALATE on structural grounds', () => {
    const contradictoryModel: StructuralSourceModel = {
      sectionCount: 2,
      sectionExtracts: [section(0, 'Section one reports Q3 revenue of four million dollars driven by renewals'), section(1, 'Section two reports Q3 revenue of five million dollars driven by new business')],
      synthesis: 'The two sections report conflicting revenue figures for Q3 that could not be reconciled from the extraction notes alone.',
    }
    const acknowledgingAnswer = 'The sources report conflicting Q3 revenue figures -- four million versus five million dollars -- and this discrepancy could not be resolved from the available material; further verification is recommended before relying on either number.'
    const result = evaluateCeoQuality({ objective: 'What was our Q3 revenue?', content: acknowledgingAnswer, path: 'full', intent: 'analysis', reviewed: false, externalExecutionSucceeded: true, comprehensionMode: 'deep_analysis', structuralSourceModel: contradictoryModel })
    expect(result.structuralQuality?.contradictionPreserved).toBe(true)
    expect(result.failureReason).not.toBe('claim_consistency_failure')
  })

  test('without a structural source model, behavior is completely unchanged from before this recommendation', () => {
    const result = evaluateCeoQuality({ objective, content: goodSynthesisAnswer, path: 'full', intent: 'analysis', reviewed: false, externalExecutionSucceeded: true, comprehensionMode: 'deep_analysis' })
    expect(result.structuralQuality?.applicable).toBe(false)
  })
})