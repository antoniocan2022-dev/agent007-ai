/**
 * Public transport boundary for CEO SSE events.
 *
 * Internal control-plane objects are never copied wholesale onto the wire.
 * Each public event is projected from an explicit allowlist of user-safe fields.
 * This is intentionally deterministic and adds no model call or reasoning cost.
 */
export type CeoPublicTransportEvent =
  | 'answer'
  | 'done'
  | 'error'
  | 'superseded'
  | 'duplicate'
  | 'progress'
  | 'ping'

const PUBLIC_FIELDS_BY_EVENT: Record<CeoPublicTransportEvent, readonly string[]> = {
  answer: ['content', 'provider', 'model', 'responseMs', 'messageId', 'requestId', 'deployment'],
  done: ['messageId', 'steps', 'provider', 'model', 'responseMs', 'requestId', 'deployment', 'recoveryCount'],
  error: ['message', 'retryable', 'requestId', 'deployment'],
  superseded: ['reason', 'requestId', 'deployment'],
  duplicate: ['message', 'requestId', 'deployment'],
  progress: ['phase', 'count', 'maxRecoveries'],
  ping: ['ts'],
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function resolveCeoPublicSseEvent(event: string): CeoPublicTransportEvent {
  return event === 'answer' || event === 'done' || event === 'error' || event === 'superseded' || event === 'duplicate' || event === 'progress' || event === 'ping'
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

  // Unknown and internal event sources are collapsed to a coarse public progress state.
  if (safeEvent === 'progress' && !projected.phase) projected.phase = 'processing'
  return projected
}

export function isSupportedCeoPublicTransportEvent(event: string): event is CeoPublicTransportEvent {
  return event === 'answer' || event === 'done' || event === 'error' || event === 'superseded' || event === 'duplicate' || event === 'progress' || event === 'ping'
}
