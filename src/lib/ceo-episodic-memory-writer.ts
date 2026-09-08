import { db } from './db'
import { deriveEpisodicDecisionWrites } from './ceo-episodic-memory'
import type { CeoConversationState } from './ceo-conversation-state'

// Prisma's delete throws P2025 (RecordNotFound) whenever the target row never existed -- an expected,
// benign outcome here (a decision can be marked superseded before this writer ever got a chance to
// persist it as current in the first place), not a real failure worth logging as one.
function isRecordNotFoundError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'P2025'
}

function logEpisodicMemoryFailure(op: 'upsert' | 'delete', key: string, error: unknown): void {
  if (op === 'delete' && isRecordNotFoundError(error)) return
  console.warn(`[ceo-episodic-memory] ${op} failed for ${key}:`, error instanceof Error ? error.message.slice(0, 180) : String(error))
}

/**
 * Best-effort persistence for deriveEpisodicDecisionWrites (see ceo-episodic-memory.ts for the actual
 * decision logic). Never throws -- every individual write is caught independently so one bad write (or
 * the database being briefly unavailable) never blocks the others or the caller. Callers should await
 * it for ordering but must treat it as fire-and-forget in every other sense: it must never be allowed
 * to affect the user-facing response.
 *
 * Deep-audit fix: failures were previously swallowed with no logging at all (`.catch(() => {})`), which
 * matters more here than for a typical best-effort write: a delete failure is not retried on a later
 * turn once the superseded decision ages out of decisionSignals' own 12-entry window (see
 * ceo-episodic-memory.ts), so a stale, corrected-away decision could persist and keep surfacing in
 * future conversations' SELECTED MEMORY block indefinitely, with zero observability that it happened.
 * Every other best-effort catch on this request path (route.ts's conversation-row load, memory query,
 * turn-marker close) already logs via console.warn; this now matches that convention rather than being
 * a silent, harder-to-diagnose exception to it. Still deliberately not retried here -- see the "known,
 * accepted limitation" note in ceo-episodic-memory.ts for why a full reconciliation pass is out of scope
 * for this fix.
 */
export async function persistEpisodicDecisionMemory(state: Pick<CeoConversationState, 'decisions' | 'supersededDecisions'>): Promise<void> {
  const { upserts, deletes } = deriveEpisodicDecisionWrites(state)
  await Promise.all([
    ...upserts.map((write) => db.memory.upsert({ where: { key: write.key }, create: { key: write.key, value: write.value, category: write.category }, update: { value: write.value, category: write.category } }).catch((error) => logEpisodicMemoryFailure('upsert', write.key, error))),
    ...deletes.map((del) => db.memory.delete({ where: { key: del.key } }).catch((error) => logEpisodicMemoryFailure('delete', del.key, error))),
  ])
}
