import { describe, expect, test, afterEach } from 'bun:test'
import { buildHierarchicalComprehensionPlan, buildDocumentComprehensionTrace } from '@/lib/ceo-document-comprehension'
import { executeHierarchicalComprehension, shouldExecuteHierarchicalComprehension, EXECUTION_NECESSITY_SECTION_THRESHOLD, DOCUMENT_COMPREHENSION_EXECUTION_SECTION_THRESHOLD } from '@/lib/ceo-document-comprehension-executor'
import { resetProviderHealthForTests } from '@/lib/provider-intelligence'
import { resetProviderStandingForTests } from '@/lib/provider-standing'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
  for (const key of ['GROQ_API_KEY', 'CLOUDFLARE_API_KEY', 'CLOUDFLARE_ACCOUNT_ID', 'MISTRAL_API_KEY', 'CEREBRAS_API_KEY', 'OPENROUTER_API_KEY']) delete process.env[key]
})

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
}

function paragraphs(count: number, wordsPerParagraph = 30): string[] {
  return Array.from({ length: count }, (_, index) => Array.from({ length: wordsPerParagraph }, (_, w) => `p${index}w${w}`).join(' '))
}

// Small sectionBudgetChars keeps fixtures short while still producing several real sections.
function bigPlan(sectionCount = 8) {
  const doc = paragraphs(sectionCount * 3, 20).join('\n\n')
  return buildHierarchicalComprehensionPlan('Summarize the key points.', doc, 300)
}

describe('shouldExecuteHierarchicalComprehension: necessity gate', () => {
  test('a short document does not meet the execution necessity bar', () => {
    const trace = buildDocumentComprehensionTrace('A short note.')
    expect(shouldExecuteHierarchicalComprehension(trace)).toBe(false)
  })

  test('all explicit document operations use the strengthened two-section threshold', () => {
    const doc = paragraphs(4, 20).join('\n\n')
    const trace = buildDocumentComprehensionTrace(doc, 300)
    expect(trace.sectionCount).toBeGreaterThanOrEqual(DOCUMENT_COMPREHENSION_EXECUTION_SECTION_THRESHOLD)
    expect(shouldExecuteHierarchicalComprehension(trace, 'document_summary')).toBe(true)
    expect(shouldExecuteHierarchicalComprehension(trace, 'document_critique')).toBe(true)
    expect(shouldExecuteHierarchicalComprehension(trace, 'document_compare')).toBe(true)
    expect(shouldExecuteHierarchicalComprehension(trace, 'document_extract')).toBe(true)
  })

  test('a document with more than one but fewer than the necessity threshold sections still does not qualify', () => {
    const doc = paragraphs(6, 20).join('\n\n')
    const trace = buildDocumentComprehensionTrace(doc, 300)
    expect(trace.requiresHierarchicalComprehension).toBe(true)
    expect(trace.sectionCount).toBeLessThan(EXECUTION_NECESSITY_SECTION_THRESHOLD)
    expect(shouldExecuteHierarchicalComprehension(trace)).toBe(false)
  })


  test('an explicit document_comprehension operation strengthens the gate for a genuine multi-section source', () => {
    const doc = paragraphs(DOCUMENT_COMPREHENSION_EXECUTION_SECTION_THRESHOLD * 2, 20).join('\n\n')
    const trace = buildDocumentComprehensionTrace(doc, 300)
    expect(trace.sectionCount).toBeGreaterThanOrEqual(DOCUMENT_COMPREHENSION_EXECUTION_SECTION_THRESHOLD)
    expect(trace.sectionCount).toBeLessThan(EXECUTION_NECESSITY_SECTION_THRESHOLD)
    expect(shouldExecuteHierarchicalComprehension(trace, 'document_comprehension')).toBe(true)
    expect(shouldExecuteHierarchicalComprehension(trace)).toBe(false)
  })

  test('a document at or above the necessity threshold qualifies', () => {
    const doc = paragraphs(30, 20).join('\n\n')
    const trace = buildDocumentComprehensionTrace(doc, 300)
    expect(trace.sectionCount).toBeGreaterThanOrEqual(EXECUTION_NECESSITY_SECTION_THRESHOLD)
    expect(shouldExecuteHierarchicalComprehension(trace)).toBe(true)
  })
})

describe('executeHierarchicalComprehension: single_pass plans are a pure no-op', () => {
  test('never calls the provider layer for a single_pass plan', async () => {
    let fetchCalled = false
    globalThis.fetch = (async () => { fetchCalled = true; throw new Error('should not be called') }) as typeof fetch
    const plan = buildHierarchicalComprehensionPlan('What is this?', 'A short document.')
    expect(plan.strategy).toBe('single_pass')
    const result = await executeHierarchicalComprehension(plan)
    expect(result.executed).toBe(false)
    expect(fetchCalled).toBe(false)
  })
})

describe('executeHierarchicalComprehension: map_reduce execution', () => {

  test('complete flag distinguishes partial from complete coverage', async () => {
    process.env.GROQ_API_KEY = 'test-groq'
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); const method = String(init?.method ?? 'GET')
      if (url.includes('groq.com') && method === 'GET') return jsonResponse({ data: [{ id: 'llama-3.3-70b-versatile' }] })
      if (url.includes('groq.com') && init?.method === 'POST') {
        const body = JSON.parse(String(init?.body ?? '{}'))
        const isReduce = body.messages.some((m: { content: string }) => m.content.includes('extraction notes'))
        const firstPrompt = String(body.messages[0]?.content ?? '')
        if (!isReduce && firstPrompt.includes('section 1 of')) return jsonResponse({ error: { message: 'upstream unavailable' } }, 503)
        return jsonResponse({ choices: [{ message: { content: isReduce ? 'Partial synthesis.' : 'Extraction note.' } }] })
      }
      throw new Error(`unexpected call: ${url}`)
    }) as typeof fetch
    const plan = bigPlan(6)
    const partial = await executeHierarchicalComprehension(plan, { timeBudgetMs: 30_000 })
    expect(partial.executed).toBe(true)
    expect(partial.complete).toBe(false)
    resetProviderHealthForTests()
    resetProviderStandingForTests()
  })


  test('an insufficient time budget skips execution without calling the provider layer', async () => {
    let fetchCalled = false
    globalThis.fetch = (async () => { fetchCalled = true; throw new Error('should not be called') }) as typeof fetch
    const plan = bigPlan()
    const result = await executeHierarchicalComprehension(plan, { timeBudgetMs: 1000 })
    expect(result.executed).toBe(false)
    expect(fetchCalled).toBe(false)
  })

  // Deep-audit fix (2026-09-20): MIN_STEP_TIMEOUT_MS is a floor, not a proportional share -- at a batch
  // count this plan actually has (2, at concurrency 4), flooring every call to at least 4000ms can push
  // the real worst-case wall time (2 map batches + 1 reduce, each floored) above a timeBudgetMs that
  // comfortably clears MIN_VIABLE_TIME_BUDGET_MS (8000ms) on its own. Before this fix, execution would
  // have been attempted anyway and could overrun the caller's actual time budget -- eating into time the
  // primary generation call needs afterward, exactly what this executor promises never to do.
  test('a time budget that would overrun once this plan\'s own batch count is accounted for is skipped, not attempted', async () => {
    let fetchCalled = false
    globalThis.fetch = (async () => { fetchCalled = true; throw new Error('should not be called') }) as typeof fetch
    const plan = bigPlan(5)
    expect(plan.mapSteps.length).toBeGreaterThan(4) // guarantees 2 map batches at concurrency 4
    expect(plan.mapSteps.length).toBeLessThanOrEqual(8)
    // 9000ms clears MIN_VIABLE_TIME_BUDGET_MS on its own, but this plan still cannot fit its
    // sequential map/reduce timeout allocation without exceeding that budget.
    const result = await executeHierarchicalComprehension(plan, { timeBudgetMs: 9000 })
    expect(result.executed).toBe(false)
    expect(fetchCalled).toBe(false)
    expect(result.failureNotes.some((note) => note.includes('Insufficient time budget'))).toBe(true)
  })

  test('every section succeeding produces a synthesis covering all sections', async () => {
    process.env.GROQ_API_KEY = 'test-groq'
    let mapCalls = 0
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); const method = String(init?.method ?? 'GET')
      if (url.includes('groq.com') && method === 'GET') return jsonResponse({ data: [{ id: 'llama-3.3-70b-versatile' }] })
      if (url.includes('groq.com') && method === 'POST') {
        const body = JSON.parse(String(init?.body ?? '{}'))
        const isReduce = body.messages.some((m: { content: string }) => m.content.includes('extraction notes'))
        if (!isReduce) mapCalls += 1
        return jsonResponse({ choices: [{ message: { content: isReduce ? 'Final synthesis covering all sections.' : 'Extraction note for a section.' } }] })
      }
      throw new Error(`unexpected call: ${url}`)
    }) as typeof fetch
    const plan = bigPlan(5)
    expect(plan.mapSteps.length).toBeLessThanOrEqual(8) // stays under the executor's MAX_SECTIONS_TO_EXECUTE cap, so this test isn't also exercising truncation
    const result = await executeHierarchicalComprehension(plan, { timeBudgetMs: 30_000 })
    expect(result.executed).toBe(true)
    expect(result.synthesis).toContain('Final synthesis')
    expect(result.sectionsFailed).toBe(0)
    expect(result.sectionsProcessed).toBe(plan.mapSteps.length)
    expect(result.complete).toBe(true)
    expect(mapCalls).toBe(plan.mapSteps.length)
  })

  test('some sections failing still produces a synthesis from the sections that succeeded, with an honest failure note', async () => {
    process.env.GROQ_API_KEY = 'test-groq'
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); const method = String(init?.method ?? 'GET')
      if (url.includes('groq.com') && method === 'GET') return jsonResponse({ data: [{ id: 'llama-3.3-70b-versatile' }] })
      if (url.includes('groq.com') && method === 'POST') {
        const body = JSON.parse(String(init?.body ?? '{}'))
        const content = String(body.messages[0]?.content ?? '')
        const isReduce = body.messages.some((m: { content: string }) => m.content.includes('extraction notes'))
        if (isReduce) return jsonResponse({ choices: [{ message: { content: 'Partial synthesis from the sections that succeeded.' } }] })
        // Fail section 1 specifically (identifiable in the map-step prompt text).
        if (content.includes('section 1 of')) return jsonResponse({ error: { message: 'upstream unavailable' } }, 503)
        return jsonResponse({ choices: [{ message: { content: 'Extraction note.' } }] })
      }
      throw new Error(`unexpected call: ${url}`)
    }) as typeof fetch
    const plan = bigPlan(6)
    const result = await executeHierarchicalComprehension(plan, { timeBudgetMs: 30_000 })
    expect(result.executed).toBe(true)
    expect(result.sectionsFailed).toBeGreaterThan(0)
    expect(result.sectionsProcessed).toBeGreaterThan(0)
    expect(result.failureNotes.some((note) => note.includes('could not be processed'))).toBe(true)
    expect(result.complete).toBe(false)
  })

  test('every section failing produces no synthesis (fail-open, not a thrown error)', async () => {
    process.env.GROQ_API_KEY = 'test-groq'
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); const method = String(init?.method ?? 'GET')
      if (url.includes('groq.com') && method === 'GET') return jsonResponse({ data: [{ id: 'llama-3.3-70b-versatile' }] })
      if (url.includes('groq.com') && method === 'POST') return jsonResponse({ error: { message: 'upstream unavailable' } }, 503)
      throw new Error(`unexpected call: ${url}`)
    }) as typeof fetch
    const plan = bigPlan(5)
    expect(plan.mapSteps.length).toBeLessThanOrEqual(8)
    const result = await executeHierarchicalComprehension(plan, { timeBudgetMs: 30_000 })
    expect(result.executed).toBe(false)
    expect(result.sectionsFailed).toBe(plan.mapSteps.length)
    expect(result.synthesis).toBeUndefined()
    expect(result.complete).toBe(false)
  })

  test('a reduce-step failure after successful maps still fails open rather than throwing', async () => {
    process.env.GROQ_API_KEY = 'test-groq'
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); const method = String(init?.method ?? 'GET')
      if (url.includes('groq.com') && method === 'GET') return jsonResponse({ data: [{ id: 'llama-3.3-70b-versatile' }] })
      if (url.includes('groq.com') && method === 'POST') {
        const body = JSON.parse(String(init?.body ?? '{}'))
        const isReduce = body.messages.some((m: { content: string }) => m.content.includes('extraction notes'))
        if (isReduce) return jsonResponse({ error: { message: 'upstream unavailable' } }, 503)
        return jsonResponse({ choices: [{ message: { content: 'Extraction note.' } }] })
      }
      throw new Error(`unexpected call: ${url}`)
    }) as typeof fetch
    const plan = bigPlan(6)
    const result = await executeHierarchicalComprehension(plan, { timeBudgetMs: 30_000 })
    expect(result.executed).toBe(false)
    expect(result.sectionsProcessed).toBeGreaterThan(0)
    expect(result.failureNotes.some((note) => note.includes('Synthesis step failed'))).toBe(true)
    expect(result.complete).toBe(false)
  })

  test('a 20-section document remains fully executable within the bounded comprehension budget', async () => {
    process.env.GROQ_API_KEY = 'test-groq'
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); const method = String(init?.method ?? 'GET')
      if (url.includes('groq.com') && method === 'GET') return jsonResponse({ data: [{ id: 'llama-3.3-70b-versatile' }] })
      if (url.includes('groq.com') && method === 'POST') {
        const body = JSON.parse(String(init?.body ?? '{}'))
        const isReduce = body.messages.some((m: { content: string }) => m.content.includes('extraction notes'))
        return jsonResponse({ choices: [{ message: { content: isReduce ? 'Synthesis covering all processed sections.' : 'Extraction note.' } }] })
      }
      throw new Error(`unexpected call: ${url}`)
    }) as typeof fetch
    const plan = bigPlan(20)
    const result = await executeHierarchicalComprehension(plan, { timeBudgetMs: 30_000 })
    expect(result.executed).toBe(true)
    expect(result.sectionsProcessed).toBe(plan.mapSteps.length)
    expect(result.sectionsFailed).toBe(0)
    expect(result.complete).toBe(true)
    expect(result.failureNotes.some((note) => note.includes('bounded execution limit'))).toBe(false)
  })
})