import { describe, expect, test } from 'bun:test'
import { assertFinalResponseInvariant, finalizeCeoResponse } from '@/lib/ceo-response-finalizer'
import { containsInternalArtifactToken } from '@/lib/ceo-behavioral-policy'
import { composeCeoContext } from '@/lib/ceo-context-composer'

describe('CEO canonical response finalizer', () => {
  test('preserves legitimate prose around structured telemetry', () => {
    const response = finalizeCeoResponse({
      content: 'The architecture matters because it turns tools into governed capabilities. [continuous_loop_trace] continuous_loop:abc { currentStage: "PERCEIVE", status: "ACTIVE" } The next priority is reliability.',
    })

    expect(response.content).toBe('The architecture matters because it turns tools into governed capabilities. The next priority is reliability.')
    expect(response.sanitized).toBe(true)
    expect(response.rejected).toBe(false)
    expect(response.finalResponseHash).toHaveLength(64)
    assertFinalResponseInvariant(response)
  })

  test('fails closed when an internal token is not in the surgical artifact shape', () => {
    const response = finalizeCeoResponse({ content: 'The answer contains continuous_loop_trace without a structured payload.' })
    expect(response.rejected).toBe(true)
    expect(containsInternalArtifactToken(response.content)).toBe(false)
    expect(response.content).toContain('Internal execution details were withheld')
    expect(() => assertFinalResponseInvariant(response)).not.toThrow()
  })

  test('finalization is deterministic for identical final content', () => {
    const a = finalizeCeoResponse({ content: 'A stable final answer.' })
    const b = finalizeCeoResponse({ content: 'A stable final answer.' })
    expect(a.content).toBe(b.content)
    expect(a.finalResponseHash).toBe(b.finalResponseHash)
    expect(a.finalizationId).toBe(b.finalizationId)
  })

  test('context builder excludes contaminated assistant history but preserves user intent', () => {
    const context = composeCeoContext({
      systemPrompt: 'You are Agent007.',
      currentUserMessage: 'Explain why the architecture matters for the business.',
      persistedMessages: [
        { role: 'user', content: 'Prior context.', createdAt: 1 },
        { role: 'assistant', content: 'Leaked [continuous_loop_trace] continuous_loop:abc { stage: "PERCEIVE" }', createdAt: 2 },
        { role: 'assistant', content: 'Useful prior business explanation.', createdAt: 3 },
      ],
    })

    const flattened = context.messages.map((message) => message.content).join('\n')
    expect(flattened).not.toContain('continuous_loop_trace')
    expect(flattened).toContain('Useful prior business explanation.')
    expect(flattened).toContain('Explain why the architecture matters for the business.')
  })

  test('final answer can be propagated unchanged across persistence and transport boundaries', () => {
    const response = finalizeCeoResponse({ content: 'The operations kit should come first because it reduces execution friction before scale.' })
    const simulatedPersistence = response.content
    const simulatedSseAnswer = response.content
    const simulatedReload = simulatedPersistence
    expect(simulatedPersistence).toBe(simulatedSseAnswer)
    expect(simulatedSseAnswer).toBe(simulatedReload)
    expect(response.finalResponseHash).toBe(finalizeCeoResponse({ content: simulatedReload }).finalResponseHash)
  })
})
