import { db } from './db'
import { deriveEpisodicDecisionWrites } from './ceo-episodic-memory'
import type { CeoConversationState } from './ceo-conversation-state'

/**
 * Best-effort persistence for deriveEpisodicDecisionWrites (see ceo-episodic-memory.ts for the actual
 * decision logic). Never throws -- every individual write is caught independently so one bad write (or
 * the database being briefly unavailable) never blocks the others or the caller. Callers should await
 * it for ordering but must treat it as fire-and-forget in every other sense: it must never be allowed
 * to affect the user-facing response.
 */
export async function persistEpisodicDecisionMemory(state: Pick<CeoConversationState, 'decisions' | 'supersededDecisions'>): Promise<void> {
  const { upserts, deletes } = deriveEpisodicDecisionWrites(state)
  await Promise.all([
    ...upserts.map((write) => db.memory.upsert({ where: { key: write.key }, create: { key: write.key, value: write.value, category: write.category }, update: { value: write.value, category: write.category } }).catch(() => {})),
    ...deletes.map((del) => db.memory.delete({ where: { key: del.key } }).catch(() => {})),
  ])
}
