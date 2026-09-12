import { describe, expect, test } from 'bun:test'
import { buildCeoContextModules, composeCeoContext } from '@/lib/ceo-context-composer'

// Part B (document-ingestion pipeline): a new 'knowledge' module surfaces chunks retrieved from
// the user's ingested documents (see knowledge-base.ts's searchKnowledgeBase, wired in route.ts).
// It must follow the exact same conditional-inclusion discipline as the sibling mission/evidence/
// execution/attachments/self_inspection modules: present only when there is something to show,
// never an always-on "no knowledge base results" placeholder that would add noise to every turn.

const rows = [
  { role: 'user' as const, content: 'Hello there', createdAt: 0 },
  { role: 'assistant' as const, content: 'Hi! How can I help?', createdAt: 1 },
]

describe('buildCeoContextModules: knowledge module policy', () => {
  test('omits the knowledge module when no knowledge-base results were supplied', () => {
    const modules = buildCeoContextModules({ intent: 'conversation', missionRelevant: false, evidenceClass: 'none', executionRequirement: 'standard' })
    expect(modules.knowledge).toBeUndefined()
  })

  test('omits the knowledge module for a blank/whitespace-only result', () => {
    const modules = buildCeoContextModules({ intent: 'conversation', missionRelevant: false, evidenceClass: 'none', executionRequirement: 'standard', knowledge: '   ' })
    expect(modules.knowledge).toBeUndefined()
  })

  test('includes the trimmed knowledge module when real results were supplied', () => {
    const modules = buildCeoContextModules({ intent: 'conversation', missionRelevant: false, evidenceClass: 'none', executionRequirement: 'standard', knowledge: '  [1] (from plan.pdf, score 3)\nOur runway is 14 months.  ' })
    expect(modules.knowledge).toBe('[1] (from plan.pdf, score 3)\nOur runway is 14 months.')
  })
})

describe('composeCeoContext: knowledge module rendering', () => {
  test('renders no knowledge system message when the module is absent', async () => {
    const composed = await composeCeoContext({ systemPrompt: 'sys', currentUserMessage: 'Hello there', persistedMessages: rows, memories: [] })
    expect(composed.modules).not.toContain('knowledge')
    expect(composed.messages.some((message) => message.content.includes('KNOWLEDGE BASE CONTEXT'))).toBe(false)
  })

  test('renders a labeled, cite-the-source system message when the module has content', async () => {
    const composed = await composeCeoContext({
      systemPrompt: 'sys',
      currentUserMessage: 'What does our contract say about termination?',
      persistedMessages: rows,
      memories: [],
      modules: { knowledge: '[1] (from contract.pdf, score 2)\nEither party may terminate with 30 days notice.' },
    })
    expect(composed.modules).toContain('knowledge')
    const knowledgeMessage = composed.messages.find((message) => message.content.includes('KNOWLEDGE BASE CONTEXT'))
    expect(knowledgeMessage?.content).toContain('cite the source document')
    expect(knowledgeMessage?.content).toContain('Either party may terminate with 30 days notice.')
  })
})
