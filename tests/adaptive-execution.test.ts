import { describe, expect, test } from 'bun:test'
import { classifyExecution, shouldUseFastLane } from '@/lib/adaptive-execution'
import { runCanonicalLlmParallel } from '@/lib/canonical-llm-router'
import { extractInstructionWindow } from '@/lib/ceo-cognitive-contract'

const user = (content: string) => [{ role: 'user', content }]

describe('Adaptive Execution Architecture', () => {
  test('routes greetings through the fast lane without deep orchestration', () => {
    const plan = classifyExecution(user('Hi!'))
    expect(plan.executionClass).toBe('fast')
    expect(plan.maxProviderAttempts).toBe(1)
    expect(plan.timeoutMs).toBe(8000)
    expect(plan.parallelizable).toBe(false)
    expect(shouldUseFastLane(plan, 0)).toBe(true)
  })

  test('keeps short informational questions fast', () => {
    const plan = classifyExecution(user('What is a database connection pool?'))
    expect(plan.executionClass).toBe('fast')
    // Raised from 1200: a real production transcript showed a short question getting a legitimate,
    // substantive answer that hit exactly this ceiling and was cut off mid-sentence. The fast lane
    // should stay cheap/quick relative to standard/deep (4000/8000), not so tight that an ordinary
    // answer runs out of room.
    expect(plan.maxTokens).toBe(2400)
    expect(plan.maxTokens).toBeGreaterThan(1200)
    expect(shouldUseFastLane(plan, 0)).toBe(true)
  })

  test('does not over-classify a simple revenue question as a mission', () => {
    const plan = classifyExecution(user('What is revenue?'))
    expect(plan.executionClass).toBe('fast')
  })

  test('preserves context for short follow-ups instead of using the fast lane', () => {
    const plan = classifyExecution(user('What about that?'))
    expect(plan.executionClass).toBe('standard')
    expect(shouldUseFastLane(plan, 0)).toBe(false)
  })

  // A short question can still ask for several structured items; the fast lane's budget is sized
  // for one short answer, not N of them.
  describe('enumeration requests get room for multiple items instead of the flat fast-lane budget', () => {
    const enumerationRequests = [
      'List 5 reasons the deal failed.',
      'Give me three examples of good copy.',
      'What are the top 5 reasons churn increased?',
      'Name four risks in the current pricing model.',
      'Provide 3 options for the pricing model.',
    ]
    for (const message of enumerationRequests) {
      test(`"${message}" is promoted out of the fast lane`, () => {
        const plan = classifyExecution(user(message))
        expect(plan.executionClass).not.toBe('fast')
        expect(plan.maxTokens).toBeGreaterThanOrEqual(4000)
      })
    }

    test('a genuinely single-item request without a count still classifies on length/keywords alone', () => {
      const plan = classifyExecution(user('List the top priority.'))
      expect(plan.executionClass).toBe('fast')
    })

    test('an ordinary short question with no enumeration language is unaffected', () => {
      const plan = classifyExecution(user('What is the weather today?'))
      expect(plan.executionClass).toBe('fast')
    })

    // Deep-audit fix: the original {0,40} char gap between the trigger word and the count false-
    // positived on ordinary sentences using "name" as a noun with an unrelated later digit.
    test('an unrelated later digit after "name" used as a noun does not falsely trigger enumeration', () => {
      const plan1 = classifyExecution(user('Her name is Sarah, we have 3 pending items.'))
      expect(plan1.executionClass).toBe('fast')
      const plan2 = classifyExecution(user('The company name is listed under 5 different filings.'))
      expect(plan2.executionClass).toBe('fast')
    })

    // Deep-audit fix (found via independent adversarial review): a time allowance is not an
    // enumeration request.
    test('a time-duration count ("give me 5 minutes") does not falsely trigger enumeration', () => {
      const plan1 = classifyExecution(user('Give me 5 minutes to review the proposal.'))
      expect(plan1.executionClass).toBe('fast')
      const plan2 = classifyExecution(user('Give me three hours to finish the audit.'))
      expect(plan2.executionClass).toBe('fast')
    })
  })

  test('attachments disable the fast lane', () => {
    const plan = classifyExecution(user('Summarize this'))
    expect(shouldUseFastLane(plan, 1)).toBe(false)
  })

  test('preserves the deep path for complex research', () => {
    const plan = classifyExecution(user('Perform a comprehensive market research, compare competitors, verify evidence, analyze pricing and give a strategic recommendation.'))
    expect(['deep', 'mission']).toContain(plan.executionClass)
    expect(plan.maxProviderAttempts).toBe(4)
    expect(plan.maxTokens).toBe(8000)
    expect(plan.parallelizable).toBe(true)
  })

  test('uses the mission lane for governed external/business actions', () => {
    const plan = classifyExecution(user('Run the production deployment after verification and execute the governed mission.'))
    expect(plan.executionClass).toBe('mission')
    expect(plan.parallelizable).toBe(true)
  })

  test('classification uses the latest user request instead of earlier conversation complexity', () => {
    const plan = classifyExecution([
      { role: 'user', content: 'Perform a deep security audit of the entire system and compare the providers.' },
      { role: 'assistant', content: 'Understood.' },
      { role: 'user', content: 'Hi' },
    ])
    expect(plan.executionClass).toBe('fast')
  })

  test('parallel execution is blocked for the fast lane before any provider call', async () => {
    const results = await runCanonicalLlmParallel([
      { messages: user('Hi!'), executionClass: 'fast' },
    ])
    expect(results).toHaveLength(1)
    expect(results[0]?.error).toBeInstanceOf(Error)
    expect((results[0]?.error as Error)?.message).toContain('fast lane request')
  })

  // Deep-audit fix (2026-09-20): classifyExecution used to window `normalized` (all whitespace,
  // including newlines, collapsed to single spaces) instead of `text` (raw, newline-preserving) before
  // calling extractInstructionWindow -- the identical newline-collapse bug Recommendation 1 fixed in
  // ceo-pre-router.ts. extractInstructionWindow's lead-in-phrase branch (SOURCE_LEAD_IN_RE) requires a
  // literal newline immediately after the phrase, so it could never fire through this file, and every
  // long paste with no matched lead-in fell back to a flat head-600-chars slice of the WHOLE document --
  // including any mission/deep-work vocabulary the document itself happened to use early on.
  describe('newline-preservation fix: a lead-in phrase followed by a pasted document is windowed correctly', () => {
    function buildDoc(): string {
      const early = "Our team will likely need to deploy new tooling eventually, but that's a side note."
      const filler = 'filler content padding out the document. '.repeat(200)
      return `Analyze this:\n${early} ${filler}\n\nWhat do you think of this report overall?`
    }

    test('classifyExecution does not promote this to the mission lane just because "deploy" appears early in the pasted document', () => {
      const plan = classifyExecution(user(buildDoc()))
      expect(plan.executionClass).not.toBe('mission')
    })

    test('the old whitespace-collapsed windowing would have captured "deploy" in its head slice -- confirms the fixture actually exercises the fix, not a scenario already handled', () => {
      const doc = buildDoc()
      const oldStyleNormalized = doc.replace(/\s+/g, ' ').trim()
      expect(extractInstructionWindow(oldStyleNormalized)).toContain('deploy')
    })
  })
})
