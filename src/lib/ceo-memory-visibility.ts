import { containsInternalArtifactToken } from './ceo-behavioral-policy'

export type ConversationalMemoryLike = { key: string; category: string; value?: string }

/**
 * Canonical visibility policy for memory objects that may be supplied to the
 * conversational CEO context.
 *
 * This is a fail-closed allowlist, not a blocklist. Only categories explicitly
 * marked as conversational are eligible, and content carrying a known control-
 * plane artifact token is rejected even when a record is accidentally stored
 * under an otherwise visible category.
 */
const CONVERSATIONAL_VISIBLE_CATEGORIES = new Set([
  'general',
  'mission',
  'strategy',
  'user_goal',
])

export function isConversationalMemoryVisible(memory: ConversationalMemoryLike): boolean {
  const category = memory.category.trim().toLowerCase()
  const key = memory.key.trim().toLowerCase()
  if (!category || !key) return false
  if (!CONVERSATIONAL_VISIBLE_CATEGORIES.has(category)) return false
  if (typeof memory.value === 'string' && containsInternalArtifactToken(memory.value)) return false
  if (containsInternalArtifactToken(memory.key)) return false
  return true
}

export function filterConversationalMemories<T extends ConversationalMemoryLike>(memories: readonly T[]): T[] {
  return memories.filter(isConversationalMemoryVisible)
}

export function getConversationalVisibleCategories(): readonly string[] {
  return [...CONVERSATIONAL_VISIBLE_CATEGORIES]
}
