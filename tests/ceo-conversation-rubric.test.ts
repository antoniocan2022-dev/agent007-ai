import { describe, expect, test } from 'bun:test'
import { scoreCeoConversationRubric } from '@/lib/ceo-conversation-rubric'
import { CEO_CONVERSATION_RUBRIC_CORPUS } from './fixtures/ceo-conversation-rubric-corpus'

// Step 3 of the conversational re-architecture: a scenario-based benchmark scored against the
// 8-dimension rubric (meaning, context, reference, truth, reasoning, continuity, naturalness,
// progression), covering ~20 hand-authored categories plus a generated volume set (139 scenarios
// total). This is a regression baseline, not a live-traffic comparison: there is only one
// conversational pipeline now (Steps 1-2 already cut over directly), so "shadow mode" here means
// this corpus runs as a broad, versioned, non-blocking signal (see the CI workflow step and
// scripts/ceo-conversation-shadow-benchmark.ts) rather than a dual old-path/new-path comparison.
// Every threshold below was calibrated against this session's actual, verified output at authoring
// time -- not aspirational guesses -- so a future change that regresses real behavior is what this
// file is meant to catch.
describe('CEO conversation rubric benchmark', () => {
  test('corpus has broad category coverage', () => {
    const categories = new Set(CEO_CONVERSATION_RUBRIC_CORPUS.map((scenario) => scenario.category))
    expect(categories.size).toBeGreaterThanOrEqual(15)
    expect(CEO_CONVERSATION_RUBRIC_CORPUS.length).toBeGreaterThanOrEqual(100)
  })

  for (const scenario of CEO_CONVERSATION_RUBRIC_CORPUS) {
    test(scenario.name, () => {
      const result = scoreCeoConversationRubric({
        objective: scenario.objective,
        content: scenario.content,
        intent: scenario.intent,
        responseAction: scenario.responseAction,
        priorTurns: scenario.priorTurns,
      })
      expect(result.composite).toBeGreaterThanOrEqual(scenario.expectMinComposite)
      for (const [dimension, min] of Object.entries(scenario.expectMin ?? {})) {
        expect(result[dimension as keyof typeof result]).toBeGreaterThanOrEqual(min as number)
      }
      for (const [dimension, max] of Object.entries(scenario.expectMax ?? {})) {
        expect(result[dimension as keyof typeof result]).toBeLessThanOrEqual(max as number)
      }
    })
  }
})
