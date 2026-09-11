import { afterEach, describe, expect, test } from 'bun:test'
import { buildCeoWorldModel } from '@/lib/ceo-world-model'
import { buildCanonicalConversationContext } from '@/lib/ceo-cognitive-conversation'
import { deriveCeoConversationState } from '@/lib/ceo-conversation-state'
import { CEO_CAPABILITY_ARCHITECTURE } from '@/lib/ceo-capability-architecture'

function contextFor(message: string) {
  const state = deriveCeoConversationState([], message)
  return buildCanonicalConversationContext({ currentMessage: message, rows: [], state, references: [], memories: [] })
}

const PROVIDER_KEYS = ['GROQ_API_KEY', 'CLOUDFLARE_API_KEY', 'CLOUDFLARE_ACCOUNT_ID', 'MISTRAL_API_KEY', 'CEREBRAS_API_KEY', 'OPENROUTER_API_KEY']
const originalEnv = new Map(PROVIDER_KEYS.map((key) => [key, process.env[key]]))

afterEach(() => {
  for (const key of PROVIDER_KEYS) {
    const original = originalEnv.get(key)
    if (original === undefined) delete process.env[key]; else process.env[key] = original
  }
})

// Live-audit finding: user.preferences was hardcoded to `[]` unconditionally -- the world model
// claimed to track user preferences but never actually derived any, regardless of what the user
// said. system.architecture/deploymentState were fixed marketing-sounding strings ('canonical CEO
// cognitive lifecycle', 'deployment requires explicit authorization') unconnected to any real
// state, and system.incidents was hardcoded to `[]` so a real provider outage would never surface.
describe('world model preferences are genuinely derived, not a permanent placeholder', () => {
  test('a stated preference is captured in user.preferences', () => {
    const message = 'I prefer concise answers over long explanations.'
    const model = buildCeoWorldModel({ context: contextFor(message), priorConversation: [{ role: 'user', content: message, createdAt: Date.now() }] })
    expect(model.user.data.preferences).toContain(message)
  })

  test('a message with no preference language leaves preferences empty', () => {
    const message = 'What is our current revenue?'
    const model = buildCeoWorldModel({ context: contextFor(message) })
    expect(model.user.data.preferences).toEqual([])
  })
})

describe('world model system facet reflects real, live provider state instead of static filler', () => {
  test('with no providers configured, incidents stays empty and deploymentState reports 0 available', () => {
    for (const key of PROVIDER_KEYS) delete process.env[key]
    const message = 'Status check.'
    const model = buildCeoWorldModel({ context: contextFor(message) })
    expect(model.system.data.incidents).toEqual([])
    expect(model.system.data.deploymentState[0]).toBe('0/0 configured providers currently available')
    expect(model.system.data.architecture[0]).toBe('0/5 LLM providers configured')
    expect(model.system.data.architecture[1]).toContain(`${CEO_CAPABILITY_ARCHITECTURE.length} governed capability domains`)
  })

  test('configuring a provider changes architecture and deploymentState to reflect it', () => {
    process.env.GROQ_API_KEY = 'test-key-not-real'
    const message = 'Status check.'
    const model = buildCeoWorldModel({ context: contextFor(message) })
    expect(model.system.data.architecture[0]).toBe('1/5 LLM providers configured (Groq)')
    expect(model.system.data.deploymentState[0]).toBe('1/1 configured providers currently available')
  })
})
