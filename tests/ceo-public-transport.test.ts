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

  // Deep-audit fix (2026-09-13): `evidenceState` used to be stripped from `done`, so there was no
  // channel at all for the client to learn a turn was MEMORY_ONLY/PARTIAL_UNCONFIRMED/UNAVAILABLE
  // rather than fully grounded, unless the response text itself happened to disclose it.
  test('done events disclose evidenceState, still strip internal contracts/metrics', () => {
    expect(projectCeoPublicSsePayload('done', {
      messageId: 'msg', steps: 2, provider: 'x', model: 'm', responseMs: 12, requestId: 'req', deployment: { deploymentId: 'd1' }, recoveryCount: 0,
      evidenceState: 'PARTIAL_UNCONFIRMED',
      decisionContract: { responseAction: 'recommend' }, executionContract: { evidenceClass: 'external_web' }, cognitiveMetrics: { score: 99 },
    })).toEqual({ messageId: 'msg', steps: 2, provider: 'x', model: 'm', responseMs: 12, requestId: 'req', deployment: { deploymentId: 'd1' }, recoveryCount: 0, evidenceState: 'PARTIAL_UNCONFIRMED' })
  })

  test('internal thought and reasoning events collapse to coarse public progress', () => {
    expect(resolveCeoPublicSseEvent('thought')).toBe('progress')
    expect(resolveCeoPublicSseEvent('reasoning')).toBe('progress')
    expect(projectCeoPublicSsePayload('thought', { content: '[continuous_loop_trace] secret execution dump' })).toEqual({ phase: 'processing' })
    expect(projectCeoPublicSsePayload('reasoning', { content: 'private chain of thought' })).toEqual({ phase: 'processing' })
  })

  // Deep-audit fix (2026-09-13): thought/args/result/preview/artifacts/verified/verificationWarning
  // used to be stripped here even though src/store/chat-store.ts already reads all of them to populate
  // the tool preview panel and the verification badge -- this is the authenticated owner's own tool
  // call on their own request, not another party's data, so hiding it broke the UI without protecting
  // anyone. Still verifies the allowlist stays explicit: an unlisted field (`internalProviderTrace`)
  // is still stripped, so this isn't a blanket pass-through.
  test('operational tool events retain UI-safe identifiers plus the fields chat-store.ts actually reads', () => {
    expect(projectCeoPublicSsePayload('tool_call', {
      stepId: 's1', stepNumber: 2, name: 'search', args: { query: 'runway' }, thought: 'Checking the runway figure.', internalProviderTrace: { secret: true },
    })).toEqual({ stepId: 's1', stepNumber: 2, name: 'search', args: { query: 'runway' }, thought: 'Checking the runway figure.' })
    expect(projectCeoPublicSsePayload('tool_result', {
      stepId: 's1', ok: true, result: 'Runway: 14 months.', preview: 'Runway: 14 months.', artifacts: ['doc_1'], verified: true, verificationWarning: undefined, internalProviderTrace: { secret: true },
    })).toEqual({ stepId: 's1', ok: true, result: 'Runway: 14 months.', preview: 'Runway: 14 months.', artifacts: ['doc_1'], verified: true })
    expect(resolveCeoPublicSseEvent('tool_call')).toBe('tool_call')
    expect(resolveCeoPublicSseEvent('tool_result')).toBe('tool_result')
  })

  test('subagent status events retain identifiers plus display fields, still strip unlisted internals', () => {
    expect(projectCeoPublicSsePayload('subagent_dispatch', {
      dispatchId: 'd1', agentId: 'a1', agentName: 'Research', stepNumber: 1, task: 'Find competitor pricing', color: 'red', icon: 'search', internalProviderTrace: { secret: true },
    })).toEqual({ dispatchId: 'd1', agentId: 'a1', agentName: 'Research', stepNumber: 1, task: 'Find competitor pricing', color: 'red', icon: 'search' })
    expect(projectCeoPublicSsePayload('subagent_complete', {
      dispatchId: 'd1', answer: 'Competitor prices range $10-15.', internalProviderTrace: { secret: true },
    })).toEqual({ dispatchId: 'd1', answer: 'Competitor prices range $10-15.' })
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

  // Re-audited (2026-09-13): orchestrator.ts emits manage_action/subagents_updated/heartbeat/
  // memory_update, and chat-store.ts has full dedicated handlers expecting these exact event names, but
  // none of the four were in CeoPublicTransportEvent -- so resolveCeoPublicSseEvent silently collapsed
  // every one to a bare progress event and the corresponding UI (self-management-action status, the
  // subagents-panel refresh signal, live heartbeat detail, the memory panel) never updated.
  test('self-management/subagent-refresh/heartbeat/memory events reach the client instead of collapsing to progress', () => {
    expect(resolveCeoPublicSseEvent('manage_action')).toBe('manage_action')
    expect(resolveCeoPublicSseEvent('subagents_updated')).toBe('subagents_updated')
    expect(resolveCeoPublicSseEvent('heartbeat')).toBe('heartbeat')
    expect(resolveCeoPublicSseEvent('memory_update')).toBe('memory_update')
    expect(projectCeoPublicSsePayload('manage_action', {
      stepId: 's1', status: 'running', action: 'create_agent', attrs: { name: 'Scout' }, thought: 'Fast-path create_agent', stepNumber: 1, internalProviderTrace: { secret: true },
    })).toEqual({ stepId: 's1', status: 'running', action: 'create_agent', attrs: { name: 'Scout' }, thought: 'Fast-path create_agent', stepNumber: 1 })
    expect(projectCeoPublicSsePayload('subagents_updated', { action: 'create_agent', internalProviderTrace: { secret: true } })).toEqual({})
    expect(projectCeoPublicSsePayload('heartbeat', {
      iteration: 3, maxIterations: 50, toolsCalled: 2, dispatchesCalled: 1, manageActionsCalled: 0, lastToolName: 'search', lastThought: 'Checking runway', startedAt: 1000, elapsedMs: 500, message: 'Working — step 3/50',
    })).toEqual({ iteration: 3, maxIterations: 50, toolsCalled: 2, lastToolName: 'search', lastThought: 'Checking runway', startedAt: 1000, elapsedMs: 500, message: 'Working — step 3/50' })
    expect(projectCeoPublicSsePayload('memory_update', { key: 'runway_months', value: '14', category: 'finance', internalProviderTrace: { secret: true } })).toEqual({ key: 'runway_months', value: '14', category: 'finance' })
  })

  test('unknown event payloads fail closed into public progress', () => {
    expect(isSupportedCeoPublicTransportEvent('answer')).toBe(true)
    expect(isSupportedCeoPublicTransportEvent('internal_debug')).toBe(false)
    expect(resolveCeoPublicSseEvent('internal_debug')).toBe('progress')
    expect(projectCeoPublicSsePayload('internal_debug', { secret: true })).toEqual({ phase: 'processing' })
  })
})
