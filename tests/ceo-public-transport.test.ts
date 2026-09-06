import { describe, expect, test } from 'bun:test'
import { isSupportedCeoPublicTransportEvent, projectCeoPublicSsePayload, resolveCeoPublicSseEvent } from '../src/lib/ceo-public-transport'

describe('CEO public transport boundary', () => {
  test('projects only explicit public answer fields', () => {
    const payload = projectCeoPublicSsePayload('answer', {
      content: 'Hello',
      provider: 'x',
      model: 'm',
      responseMs: 12,
      messageId: 'msg',
      requestId: 'req',
      decisionContract: { responseAction: 'recommend', rationale: ['secret'] },
      executionContract: { evidenceClass: 'external_web' },
      quality: { decision: 'PASS' },
      cognitiveMetrics: { score: 99 },
      evidenceTrace: { secret: true },
      context: { secret: true },
      releaseAttestation: { secret: true },
    })
    expect(payload).toEqual({ content: 'Hello', provider: 'x', model: 'm', responseMs: 12, messageId: 'msg', requestId: 'req' })
  })

  test('never exposes internal thought content', () => {
    expect(projectCeoPublicSsePayload('thought', { content: '[continuous_loop_trace] secret execution dump' })).toEqual({ message: 'Agent007 is processing the request.' })
  })

  test('coarse progress projection strips evidence and orchestration internals', () => {
    expect(projectCeoPublicSsePayload('progress', {
      phase: 'evidence_complete',
      failures: ['secret'],
      evidenceTrace: { secret: true },
      executionContract: { secret: true },
    })).toEqual({ phase: 'evidence_complete' })
  })

  test('unknown event payloads fail closed', () => {
    expect(isSupportedCeoPublicTransportEvent('answer')).toBe(true)
    expect(isSupportedCeoPublicTransportEvent('internal_debug')).toBe(false)
    expect(projectCeoPublicSsePayload('internal_debug', { secret: true })).toEqual({})
  })
})


test('resolves unsupported internal event names to public progress', () => {
  expect(resolveCeoPublicSseEvent('tool_execution_internal')).toBe('progress')
})
