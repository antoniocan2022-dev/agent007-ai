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

  test('internal thought and reasoning events collapse to coarse public progress', () => {
    expect(resolveCeoPublicSseEvent('thought')).toBe('progress')
    expect(resolveCeoPublicSseEvent('reasoning')).toBe('progress')
    expect(projectCeoPublicSsePayload('thought', { content: '[continuous_loop_trace] secret execution dump' })).toEqual({ phase: 'processing' })
    expect(projectCeoPublicSsePayload('reasoning', { content: 'private chain of thought' })).toEqual({ phase: 'processing' })
  })

  test('safe operational tool events retain UI-safe identifiers only', () => {
    expect(projectCeoPublicSsePayload('tool_call', {
      stepId: 's1', stepNumber: 2, name: 'search', args: { secret: true }, thought: 'private',
    })).toEqual({ stepId: 's1', stepNumber: 2, name: 'search' })
    expect(projectCeoPublicSsePayload('tool_result', {
      stepId: 's1', ok: true, result: 'private tool output', preview: 'private',
    })).toEqual({ stepId: 's1', ok: true })
    expect(resolveCeoPublicSseEvent('tool_call')).toBe('tool_call')
    expect(resolveCeoPublicSseEvent('tool_result')).toBe('tool_result')
  })

  test('safe subagent status events retain identifiers but strip internal content', () => {
    expect(projectCeoPublicSsePayload('subagent_dispatch', {
      dispatchId: 'd1', agentId: 'a1', agentName: 'Research', stepNumber: 1, task: 'private task', color: 'red',
    })).toEqual({ dispatchId: 'd1', agentId: 'a1', agentName: 'Research', stepNumber: 1 })
    expect(projectCeoPublicSsePayload('subagent_complete', {
      dispatchId: 'd1', answer: 'private answer',
    })).toEqual({ dispatchId: 'd1' })
    expect(resolveCeoPublicSseEvent('subagent_thought')).toBe('progress')
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
