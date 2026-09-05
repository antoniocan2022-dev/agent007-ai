export type ConversationalMemoryLike = { key: string; category: string }

/**
 * Canonical visibility policy for memory objects that may be supplied to the
 * conversational CEO context.
 *
 * This is a fail-closed allowlist, not a blocklist. An exhaustive audit of
 * every memory category actually used anywhere in this codebase (108 at
 * last count) found 94 were NOT excluded under the prior "block known-bad
 * categories" approach -- venture/portfolio/career-command/architecture/
 * executive/self-healing categories, rate limiting, dedup locks, server
 * errors, and more, none of which are conversational content. A reactive
 * blocklist cannot keep pace with a system this size; every new internal
 * category is a silent leak until someone remembers to add it (this
 * happened twice already: continuous_loop_trace, then governed_evolution_cycle).
 *
 * Only categories explicitly listed here are ever visible to conversational
 * context. Everything else -- known today or added tomorrow -- is internal
 * by default.
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
  return CONVERSATIONAL_VISIBLE_CATEGORIES.has(category)
}

export function filterConversationalMemories<T extends ConversationalMemoryLike>(memories: readonly T[]): T[] {
  return memories.filter(isConversationalMemoryVisible)
}

export function getConversationalVisibleCategories(): readonly string[] {
  return [...CONVERSATIONAL_VISIBLE_CATEGORIES]
}
