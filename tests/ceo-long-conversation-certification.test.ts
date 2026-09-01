import { describe, expect, test } from 'bun:test'
import { buildCanonicalConversationContext } from '@/lib/ceo-cognitive-conversation'
import { buildConversationDecisionContract } from '@/lib/ceo-conversation-decision-contract'
import { deriveCeoConversationState } from '@/lib/ceo-conversation-state'
import { scoreCeoConversationQuality } from '@/lib/ceo-response-quality-gate'
import { CEO_LONG_CONVERSATION_CORPUS } from './fixtures/ceo-long-conversation-corpus'

describe('CEO long-conversation certification P2', () => {
  for (const scenario of CEO_LONG_CONVERSATION_CORPUS) {
    test(`${scenario.name} preserves meaning at 20/30/50 turns`, () => {
      expect(scenario.rows).toHaveLength(50)
      expect(scenario.checkpoints.map((checkpoint) => checkpoint.turn)).toEqual([20, 30, 50])

      for (const checkpoint of scenario.checkpoints) {
        const prefix = scenario.rows.slice(0, checkpoint.turn)
        expect(prefix).toHaveLength(checkpoint.turn)

        const state = deriveCeoConversationState(prefix, checkpoint.responseObjective)
        expect(state.recentUserGoals.join(' ').toLowerCase()).toContain(checkpoint.expectedGoal.toLowerCase())
        expect(state.decisions.join(' ').toLowerCase()).toContain(checkpoint.expectedDecision.toLowerCase())
        expect(state.recentCorrections.join(' ').toLowerCase()).toContain(checkpoint.expectedCorrection.toLowerCase())
        expect(state.unresolvedQuestions.join(' ').toLowerCase()).toContain(checkpoint.expectedOpenLoop.toLowerCase())

        const context = buildCanonicalConversationContext({
          currentMessage: checkpoint.responseObjective,
          rows: prefix,
          state,
          references: [],
          memories: [],
        })
        const contract = buildConversationDecisionContract(context)
        expect(contract.completeness).toBe('complete')
        expect(contract.clarificationRequired).toBe(false)
        expect(contract.responseRegister).toMatch(/^(conversational|executive|strategic)$/)
        expect(['deep', 'strategic']).toContain(contract.cognitiveDepth)

        const quality = scoreCeoConversationQuality({
          objective: checkpoint.responseObjective,
          content: checkpoint.responseContent,
          priorTurns: prefix,
          relevantOlderMessages: prefix,
        })
        expect(quality.score).toBeGreaterThanOrEqual(75)
        expect(quality.continuity).toBeGreaterThanOrEqual(70)
        expect(quality.relevance).toBeGreaterThanOrEqual(70)
        expect(quality.naturalness).toBeGreaterThanOrEqual(80)
      }
    })
  }
})
