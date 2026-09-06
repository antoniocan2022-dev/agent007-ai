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

  test('internal thought events collapse to coarse public progress', () => {
    expect(projectCeoPublicSsePayload('thought', { content: '[continuous_loop_trace] secret execution dump' })).toEqual({ phase: 'processing' })
    expect(resolveCeoPublicSseEvent('thought')).toBe('progress')
  })

  test('coarse progress projection strips evidence and orchestration internals', () => {
    expect(projectCeoPublicSsePayload('progress', {
      phase: 'evidence_complete',
      failures: ['secret'],
      evidenceTrace: { secret: true },
      executionContract: { secret: true },
    })).toEqual({ phase: 'evidence_complete' })
  })

  test('unknown event payloads fail closed into public progress', () => {
    expect(isSupportedCeoPublicTransportEvent('answer')).toBe(true)
    expect(isSupportedCeoPublicTransportEvent('internal_debug')).toBe(false)
    expect(resolveCeoPublicSseEvent('internal_debug')).toBe('progress')
    expect(projectCeoPublicSsePayload('internal_debug', { secret: true })).toEqual({ phase: 'processing' })
  })
})
