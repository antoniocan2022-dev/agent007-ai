import { describe, expect, test } from 'bun:test'
import { buildConversationIncidentContract } from '@/lib/ceo-conversation-incident'
import { buildIncidentRegressionCandidate, promoteApprovedCandidateToFixtureEntry, type IncidentRegressionCandidate } from '@/lib/ceo-incident-regression-candidate'

describe('Incident-to-candidate-regression pipeline', () => {
  test('a candidate is generated with the observed classification, not an assumed-correct one, and starts as status candidate', () => {
    const incident = buildConversationIncidentContract({ objective: 'No, I meant routing as the first engineering priority.', intent: 'conversation', failureReason: 'continuity_failure' })
    const candidate = buildIncidentRegressionCandidate({ incident, message: 'No, I meant routing as the first engineering priority.' })
    expect(candidate.status).toBe('candidate')
    expect(candidate.inputClass).toBe('correction')
    expect(candidate.observedIntent).toBe('conversation')
    expect(candidate.expectedIntent).toBeUndefined()
  })

  test('inputClass classification covers the same taxonomy as the existing behavioral corpus', () => {
    const cases: Array<[string, string]> = [
      ['I dont understand.', 'confusion'],
      ['No, that is not what I meant.', 'correction'],
      ['Continue with the second one.', 'continuation'],
      ['Are you ready to lead businesses?', 'self_assessment'],
      ['What is our long-term strategy here?', 'strategic_question'],
      ['Explain why this matters.', 'explanation_request'],
      ['Please deploy the latest build.', 'action_request'],
    ]
    for (const [message, expected] of cases) {
      const incident = buildConversationIncidentContract({ objective: message, intent: 'conversation', failureReason: 'quality_failure' })
      const candidate = buildIncidentRegressionCandidate({ incident, message })
      expect(candidate.inputClass).toBe(expected)
    }
  })

  test('promotion is refused for a candidate that has not been explicitly approved -- this is the human-governance gate', () => {
    const incident = buildConversationIncidentContract({ objective: 'test message', intent: 'conversation', failureReason: 'quality_failure' })
    const candidate = buildIncidentRegressionCandidate({ incident, message: 'test message' })
    expect(() => promoteApprovedCandidateToFixtureEntry(candidate, 'name')).toThrow()
  })

  test('promotion is refused even for an approved-status candidate if the expected values were never actually filled in', () => {
    const incident = buildConversationIncidentContract({ objective: 'test message', intent: 'conversation', failureReason: 'quality_failure' })
    const candidate: IncidentRegressionCandidate = { ...buildIncidentRegressionCandidate({ incident, message: 'test message' }), status: 'approved' }
    expect(() => promoteApprovedCandidateToFixtureEntry(candidate, 'name')).toThrow()
  })

  test('a genuinely reviewed and approved candidate promotes cleanly to a usable fixture entry', () => {
    const incident = buildConversationIncidentContract({ objective: 'No, I meant routing as the first engineering priority.', intent: 'conversation', failureReason: 'continuity_failure' })
    const candidate: IncidentRegressionCandidate = { ...buildIncidentRegressionCandidate({ incident, message: 'No, I meant routing as the first engineering priority.' }), status: 'approved', expectedIntent: 'conversation', expectedSpeechAct: 'correction', expectedAction: 'answer' }
    const entry = promoteApprovedCandidateToFixtureEntry(candidate, 'explicit correction with priority language')
    expect(entry.category).toBe('correction')
    expect(entry.expected.intent).toBe('conversation')
    expect(entry.expected.responseAction).toBe('answer')
  })
})
