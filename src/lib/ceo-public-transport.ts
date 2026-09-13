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
  | 'manage_action'
  | 'subagents_updated'
  | 'heartbeat'
  | 'memory_update'

// Deep-audit fix (2026-09-13): this boundary's own docstring frames it as a defense against an
// untrusted public audience, but /api/agent requires an authenticated session whose conversation
// ownership is checked (see route.ts), and its only consumer is this same app's own chat UI showing a
// user their own request. Two independent gaps traced end-to-end to the frontend before this fix:
//   1. `done`'s allowlist had no `evidenceState`, so the client had no channel at all to learn a turn
//      was MEMORY_ONLY/PARTIAL_UNCONFIRMED/UNAVAILABLE rather than fully grounded, unless the response
//      text itself happened to say so. `tool_result` had no `verified`/`verificationWarning` either,
//      so an unverified tool action (e.g. a tool claiming success with no real artifact found --
//      exactly what orchestrator.ts's verifyToolAction exists to catch) was indistinguishable in the UI
//      from a verified one. Both are now allowed through -- they are the honest-disclosure signals this
//      whole codebase's degraded/verification machinery exists to produce, and hiding them from the
//      user defeats that purpose without protecting anyone.
//   2. src/store/chat-store.ts already reads `thought`/`args` (tool_call, subagent_tool_call),
//      `result`/`preview`/`artifacts` (tool_result, subagent_tool_result), `color`/`icon`/`task`
//      (subagent_dispatch), and `answer` (subagent_complete) -- none of which were ever allowed
//      through, so those UI panels (tool preview, subagent identity, subagent final answer) could never
//      populate. Not a leak in the other direction: this is the user's own tool call/result on their own
//      request, not another user's or the model's raw internal reasoning (still excluded via
//      INTERNAL_EVENT_NAMES below).
// Re-audited (2026-09-13): a third, more severe gap in the same shape -- orchestrator.ts actually emits
// `manage_action`, `subagents_updated`, `heartbeat`, and `memory_update` (self-management-action status,
// the sub-agents-panel refresh signal, the live progress heartbeat, and the memory panel), and
// chat-store.ts has full dedicated handlers for all four expecting these exact event names -- but none
// of the four were in the CeoPublicTransportEvent union at all, so resolveCeoPublicSseEvent silently
// collapsed every one of them to a bare `{phase:'processing'}` progress event before it ever reached the
// client. Self-management-action UI, subagent-list refresh, live heartbeat detail, and the memory panel
// were all dark in production. Same trust boundary as the fields restored above: this is the user's own
// turn's own status/telemetry about actions taken on their own request, not another user's data or the
// model's raw internal reasoning.
const PUBLIC_FIELDS_BY_EVENT: Record<CeoPublicTransportEvent, readonly string[]> = {
  answer: ['content', 'provider', 'model', 'responseMs', 'messageId', 'requestId', 'deployment'],
  done: ['messageId', 'steps', 'provider', 'model', 'responseMs', 'requestId', 'deployment', 'recoveryCount', 'evidenceState'],
  error: ['message', 'retryable', 'requestId', 'deployment'],
  superseded: ['reason', 'requestId', 'deployment'],
  duplicate: ['message', 'requestId', 'deployment'],
  progress: ['phase', 'message', 'count', 'maxRecoveries'],
  ping: ['ts'],
  // Status plus this turn's own tool call/result/verification -- never routing contracts, evidence
  // traces, or telemetry.
  tool_call: ['stepId', 'stepNumber', 'name', 'thought', 'args'],
  tool_result: ['stepId', 'ok', 'result', 'preview', 'artifacts', 'verified', 'verificationWarning'],
  subagent_dispatch: ['dispatchId', 'agentId', 'agentName', 'stepNumber', 'color', 'icon', 'task'],
  subagent_complete: ['dispatchId', 'answer'],
  subagent_tool_call: ['dispatchId', 'stepId', 'stepNumber', 'name', 'thought', 'args'],
  subagent_tool_result: ['dispatchId', 'stepId', 'ok', 'result', 'preview', 'artifacts'],
  // Final answer chunks are public content by design. They contain no execution metadata.
  token: ['content'],
  // The UI may show a coarse synthesis state, never the internal synthesis prompt/draft.
  synthesis: ['message'],
  // Status plus this turn's own self-management action result -- chat-store.ts's manage_action handler
  // reads exactly these fields (stepId/status to locate and update the step, the rest to render it).
  manage_action: ['stepId', 'status', 'action', 'attrs', 'thought', 'stepNumber', 'result'],
  // Pure refresh signal -- chat-store.ts's handler ignores the payload entirely and just bumps a
  // counter, so no fields are needed on the wire.
  subagents_updated: [],
  // chat-store.ts stores this payload verbatim as UI heartbeat state; scoped to exactly the fields that
  // state shape reads (iteration/maxIterations/toolsCalled/lastToolName/lastThought/startedAt/elapsedMs/
  // message), not the extra dispatchesCalled/manageActionsCalled counters orchestrator.ts also sends.
  heartbeat: ['iteration', 'maxIterations', 'toolsCalled', 'lastToolName', 'lastThought', 'startedAt', 'elapsedMs', 'message'],
  // The user's own memory panel entry being created/updated on their own request.
  memory_update: ['key', 'value', 'category'],
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
  return event === 'answer' || event === 'done' || event === 'error' || event === 'superseded' || event === 'duplicate' || event === 'progress' || event === 'ping' || event === 'tool_call' || event === 'tool_result' || event === 'subagent_dispatch' || event === 'subagent_complete' || event === 'subagent_tool_call' || event === 'subagent_tool_result' || event === 'token' || event === 'synthesis' || event === 'manage_action' || event === 'subagents_updated' || event === 'heartbeat' || event === 'memory_update'
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
