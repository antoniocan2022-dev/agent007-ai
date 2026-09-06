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
  | 'thought'
  | 'ping'

const PUBLIC_FIELDS_BY_EVENT: Record<CeoPublicTransportEvent, readonly string[]> = {
  answer: ['content', 'provider', 'model', 'responseMs', 'messageId', 'requestId', 'deployment'],
  done: ['messageId', 'steps', 'provider', 'model', 'responseMs', 'requestId', 'deployment', 'recoveryCount'],
  error: ['message', 'retryable', 'requestId', 'deployment'],
  superseded: ['reason', 'requestId', 'deployment'],
  duplicate: ['message', 'requestId', 'deployment'],
  progress: ['phase', 'message', 'count', 'maxRecoveries'],
  thought: ['message'],
  ping: ['ts'],
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function projectCeoPublicSsePayload(event: string, data: unknown): Record<string, unknown> {
  const safeEvent = (Object.prototype.hasOwnProperty.call(PUBLIC_FIELDS_BY_EVENT, event) ? event : 'progress') as CeoPublicTransportEvent
  const allowed = PUBLIC_FIELDS_BY_EVENT[safeEvent]
  if (!isObject(data)) return {}

  const projected: Record<string, unknown> = {}
  for (const field of allowed) {
    if (Object.prototype.hasOwnProperty.call(data, field)) projected[field] = data[field]
  }

  // Internal orchestrator "thought" content is never transported. A stable public
  // progress message preserves UI liveness without exposing execution internals.
  if (safeEvent === 'thought') return { message: 'Agent007 is processing the request.' }

  // Public progress is deliberately coarse. Detailed evidence, quality, context,
  // routing, contract and telemetry objects remain control-plane only.
  if (safeEvent === 'progress' && !projected.message && !projected.phase) projected.message = 'Agent007 is processing the request.'
  return projected
}

export function isSupportedCeoPublicTransportEvent(event: string): event is CeoPublicTransportEvent {
  return Object.prototype.hasOwnProperty.call(PUBLIC_FIELDS_BY_EVENT, event)
}
