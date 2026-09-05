// Implements the architecture's "CURRENT REQUEST LOCK" node via optimistic revision-sequencing
// rather than a physical database lock: every user turn atomically claims the next Conversation
// revision number, and a response is only ever surfaced as current if no newer turn has since
// been accepted for that conversation. This lets concurrent requests race freely -- it only stops
// a stale, already-superseded computation from being presented or persisted as the latest reply.
// The staleness check itself is performed atomically inside the same transaction as the write
// (see CeoResponseSupersededError in ceo-response-persistence.ts), not as a separate read here.

export function isUniqueConstraintViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === 'P2002')
}

export function normalizeClientRequestId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, 200)
}
