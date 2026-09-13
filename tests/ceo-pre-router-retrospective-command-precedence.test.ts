import { describe, expect, test } from 'bun:test'
import { preRouteCeoRequest } from '@/lib/ceo-pre-router'

const user = (content: string) => [{ role: 'user' as const, content }]

// Deep-audit fix (2026-09-13): isRetrospectiveConversationRequest used to be checked over the whole
// raw message before the production/mission action checks ever ran, so a compound message combining a
// retrospective clause with a real, separate command clause was entirely swallowed onto the
// conversational lane. See ceo-pre-router.ts's findTrailingProductionOrMissionIntent for the fix.
describe('pre-router: a trailing production/mission command survives a leading retrospective clause', () => {
  test.each([
    'Remind me why we chose this approach, then deploy it to production.',
    'What was the reasoning behind the pricing plan? Now ship it to production.',
    'Why did we decide on this vendor, then launch the migration.',
  ])('classifies as production_action: %s', (text) => {
    const decision = preRouteCeoRequest(user(text))
    expect(decision.executionContract.intent).toBe('production_action')
  })

  test('classifies as mission_action when the trailing clause carries a mission signal', () => {
    const decision = preRouteCeoRequest(user('Remind me why we picked this venture, then run the mission.'))
    expect(decision.executionContract.intent).toBe('mission_action')
  })

  test.each([
    'Remind me why we chose to launch the campaign this way.',
    'What was the plan for the product launch we discussed last week?',
    'Why did we decide to ship the feature behind a flag?',
  ])('a single-clause retrospective question mentioning an action word stays conversational: %s', (text) => {
    const decision = preRouteCeoRequest(user(text))
    expect(decision.executionContract.intent).toBe('conversation')
  })
})
