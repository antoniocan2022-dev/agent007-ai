/**
 * Public transport boundary for CEO SSE events.
 *
 * Internal control-plane objects are never copied wholesale onto the wire.
 * Each public event is projected from an explicit allowlist of user-safe fields.
 * This is deterministic and adds no model call or reasoning cost.
 *
 * Security rule: events carrying internal reasoning, execution arguments/results,
 * routing contracts, evidence traces, or telemetry are not public events. They are
 * collapsed to a coarse progress event rather than renamed-and-forwarded.
 */
export type CeoPublicTransportEvent =
  | 'answer'
  | 'done'
  | 'error'
  | 'superseded'
  | 'duplicate'
  | 'progress'
  | 'ping'
  | 'tool_call'
  | 'tool_result'
  | 'subagent_dispatch'
  | 'subagent_complete'
  | 'subagent_tool_call'
  | 'subagent_tool_result'
  | 'token'
  | 'synthesis'

const PUBLIC_FIELDS_BY_EVENT: Record<CeoPublicTransportEvent, readonly string[]> = {
  answer: ['content', 'provider', 'model', 'responseMs', 'messageId', 'requestId', 'deployment'],
  done: ['messageId', 'steps', 'provider', 'model', 'responseMs', 'requestId', 'deployment', 'recoveryCount'],
  error: ['message', 'retryable', 'requestId', 'deployment'],
  superseded: ['reason', 'requestId', 'deployment'],
  duplicate: ['message', 'requestId', 'deployment'],
  progress: ['phase', 'message', 'count', 'maxRecoveries'],
  ping: ['ts'],
  // UI status only. No arguments, thoughts, raw results, traces, contracts, or telemetry.
  tool_call: ['stepId', 'stepNumber', 'name'],
  tool_result: ['stepId', 'ok'],
  subagent_dispatch: ['dispatchId', 'agentId', 'agentName', 'stepNumber'],
  subagent_complete: ['dispatchId'],
  subagent_tool_call: ['dispatchId', 'stepId', 'stepNumber', 'name'],
  subagent_tool_result: ['dispatchId', 'stepId', 'ok'],
  // Final answer chunks are public content by design. They contain no execution metadata.
  token: ['content'],
  // The UI may show a coarse synthesis state, never the internal synthesis prompt/draft.
  synthesis: ['message'],
}

const INTERNAL_EVENT_NAMES = new Set([
  'thought',
  'reasoning',
  'subagent_thought',
  'evidence_trace',
  'quality_trace',
  'routing_trace',
  'continuous_loop_trace',
  'mission_telemetry',
  'runtime_telemetry',
  'provider_telemetry',
])

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function resolveCeoPublicSseEvent(event: string): CeoPublicTransportEvent {
  if (INTERNAL_EVENT_NAMES.has(event)) return 'progress'
  return event === 'answer' || event === 'done' || event === 'error' || event === 'superseded' || event === 'duplicate' || event === 'progress' || event === 'ping' || event === 'tool_call' || event === 'tool_result' || event === 'subagent_dispatch' || event === 'subagent_complete' || event === 'subagent_tool_call' || event === 'subagent_tool_result' || event === 'token' || event === 'synthesis'
    ? event
    : 'progress'
}

export function projectCeoPublicSsePayload(event: string, data: unknown): Record<string, unknown> {
  const safeEvent = resolveCeoPublicSseEvent(event)
  const allowed = PUBLIC_FIELDS_BY_EVENT[safeEvent]
  if (!isObject(data)) return safeEvent === 'progress' ? { phase: 'processing' } : {}

  const projected: Record<string, unknown> = {}
  for (const field of allowed) {
    if (Object.prototype.hasOwnProperty.call(data, field)) projected[field] = data[field]
  }

  if (safeEvent === 'progress' && !projected.phase && !projected.message) projected.phase = 'processing'
  if (safeEvent === 'synthesis' && !projected.message) projected.message = 'Agent007 is preparing the final answer.'
  return projected
}

export function isSupportedCeoPublicTransportEvent(event: string): event is CeoPublicTransportEvent {
  return resolveCeoPublicSseEvent(event) === event
}
