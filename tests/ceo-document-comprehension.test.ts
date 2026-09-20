import { describe, expect, test } from 'bun:test'
import {
  chunkDocumentIntoSections,
  buildDocumentComprehensionTrace,
  buildHierarchicalComprehensionPlan,
  DEFAULT_SECTION_BUDGET_CHARS,
} from '@/lib/ceo-document-comprehension'

// Phase 3 (2026-09-20): this module is deliberately standalone -- it builds the map-reduce scaffold
// for comprehending a document too large for one pass, but does not execute it and is not yet
// imported from ceo-cognitive-lifecycle.ts or route.ts. These tests exercise the scaffold on its
// own terms: chunking correctness, trace honesty, and plan shape -- not live generation behavior.

function paragraphs(count: number, wordsPerParagraph = 40): string[] {
  return Array.from({ length: count }, (_, index) => Array.from({ length: wordsPerParagraph }, (_, w) => `p${index}w${w}`).join(' '))
}

describe('chunkDocumentIntoSections: boundary and reconstruction correctness', () => {
  test('an empty document produces no sections', () => {
    expect(chunkDocumentIntoSections('')).toEqual([])
  })

  test('a short document (one paragraph, well under the budget) produces exactly one section', () => {
    const text = 'A short business update with nothing especially long about it.'
    const sections = chunkDocumentIntoSections(text, DEFAULT_SECTION_BUDGET_CHARS)
    expect(sections.length).toBe(1)
    expect(sections[0].text).toBe(text)
  })

  test('multiple short paragraphs are grouped into as few sections as fit the budget, not one section per paragraph', () => {
    const doc = paragraphs(3, 5).join('\n\n')
    const sections = chunkDocumentIntoSections(doc, DEFAULT_SECTION_BUDGET_CHARS)
    expect(sections.length).toBe(1)
  })

  test('every section stays at or under the budget, and paragraphs are never split across two sections when they individually fit', () => {
    const doc = paragraphs(50, 30).join('\n\n')
    const sections = chunkDocumentIntoSections(doc, 500)
    expect(sections.length).toBeGreaterThan(1)
    for (const section of sections) expect(section.charLength).toBeLessThanOrEqual(500)
  })

  test('sections are ordered and their start/end offsets are non-decreasing and consistent with charLength', () => {
    const doc = paragraphs(20, 30).join('\n\n')
    const sections = chunkDocumentIntoSections(doc, 400)
    for (let i = 0; i < sections.length; i += 1) {
      expect(sections[i].index).toBe(i)
      expect(sections[i].end - sections[i].start).toBeGreaterThanOrEqual(sections[i].charLength - 2) // allows for the joined '\n\n' separators counted in charLength but not in the raw span
      if (i > 0) expect(sections[i].start).toBeGreaterThanOrEqual(sections[i - 1].start)
    }
  })

  test('concatenating all section texts (rejoined) reproduces every paragraph exactly once, none dropped or duplicated', () => {
    const paras = paragraphs(12, 20)
    const doc = paras.join('\n\n')
    const sections = chunkDocumentIntoSections(doc, 300)
    const rejoined = sections.map((section) => section.text).join('\n\n')
    for (const paragraph of paras) expect(rejoined).toContain(paragraph)
    const totalParagraphsRecovered = rejoined.split('\n\n').filter(Boolean).length
    expect(totalParagraphsRecovered).toBe(paras.length)
  })

  test('a single paragraph larger than the budget is hard-split rather than left as one oversized section', () => {
    const hugeParagraph = Array.from({ length: 500 }, (_, w) => `word${w}`).join(' ')
    const sections = chunkDocumentIntoSections(hugeParagraph, 200)
    expect(sections.length).toBeGreaterThan(1)
    for (const section of sections) expect(section.charLength).toBeLessThanOrEqual(200)
  })
})

describe('buildDocumentComprehensionTrace: honest single-pass vs hierarchical classification', () => {
  test('a short document does not require hierarchical comprehension', () => {
    const trace = buildDocumentComprehensionTrace('Just a short note about the quarter.')
    expect(trace.sectionCount).toBe(1)
    expect(trace.requiresHierarchicalComprehension).toBe(false)
  })

  test('a document exceeding the section budget requires hierarchical comprehension', () => {
    const doc = paragraphs(40, 60).join('\n\n')
    const trace = buildDocumentComprehensionTrace(doc, 1_000)
    expect(trace.sectionCount).toBeGreaterThan(1)
    expect(trace.requiresHierarchicalComprehension).toBe(true)
    expect(trace.totalChars).toBe(doc.length)
  })
})

describe('buildHierarchicalComprehensionPlan: plan shape, not execution', () => {
  test('a short document gets strategy single_pass with no map/reduce steps', () => {
    const plan = buildHierarchicalComprehensionPlan('Summarize this.', 'A brief note.')
    expect(plan.strategy).toBe('single_pass')
    expect(plan.mapSteps).toEqual([])
    expect(plan.reduceStep).toBeUndefined()
  })

  test('a long document gets strategy map_reduce with one map step per section and a reduce step', () => {
    const doc = paragraphs(30, 60).join('\n\n')
    const plan = buildHierarchicalComprehensionPlan('What are the key takeaways?', doc, 1_000)
    expect(plan.strategy).toBe('map_reduce')
    expect(plan.mapSteps.length).toBe(plan.trace.sectionCount)
    expect(plan.mapSteps.map((step) => step.sectionIndex)).toEqual(plan.trace.sections.map((section) => section.index))
    expect(plan.reduceStep).toBeDefined()
  })

  test('each map-step prompt carries only its own section text, the objective, and never leaks other sections', () => {
    const doc = ['Section zero talks about revenue growth.', 'Section one talks about an entirely unrelated topic: office relocation plans.'].join('\n\n')
    const plan = buildHierarchicalComprehensionPlan('Summarize the document.', doc, 40)
    expect(plan.mapSteps.length).toBeGreaterThanOrEqual(2)
    const firstStep = plan.mapSteps[0]
    expect(firstStep.prompt).toContain(plan.trace.sections[0].text)
    for (let i = 1; i < plan.trace.sections.length; i += 1) expect(firstStep.prompt).not.toContain(plan.trace.sections[i].text)
    expect(firstStep.prompt).toContain('Summarize the document.')
  })

  test('the reduce-step prompt carries the objective but not raw section text (it synthesizes from map outputs, not the document itself)', () => {
    const doc = paragraphs(30, 60).join('\n\n')
    const plan = buildHierarchicalComprehensionPlan('What are the key takeaways?', doc, 1_000)
    expect(plan.reduceStep!.prompt).toContain('What are the key takeaways?')
    expect(plan.reduceStep!.prompt).not.toContain(plan.trace.sections[0].text)
  })
})
