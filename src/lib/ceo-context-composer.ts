export type CeoContextRole = 'system' | 'user' | 'assistant'

export interface PersistedConversationRow {
  role: string
  content: string
  createdAt: Date | string | number
}

export interface PersistedMemoryRow {
  key: string
  value: string
  category: string
  updatedAt: Date | string | number
}

export interface CeoContextComposition {
  messages: Array<{ role: CeoContextRole; content: string }>
  recentMessages: number
  relevantOlderMessages: number
  summarizedOlderMessages: number
  selectedMemoryKeys: string[]
}

const STOPWORDS = new Set([
  'about', 'after', 'again', 'also', 'because', 'before', 'being', 'between', 'could', 'from',
  'have', 'into', 'more', 'most', 'other', 'should', 'that', 'their', 'there', 'these', 'they',
  'this', 'those', 'through', 'under', 'what', 'when', 'where', 'which', 'while', 'with', 'would',
  'your', 'agent007', 'please', 'then', 'than', 'just', 'like', 'really', 'very', 'doing', 'does',
  'doesnt', 'dont', 'you', 'are', 'how', 'why', 'can', 'could', 'tell', 'give', 'make', 'want',
])

const DEFAULT_RECENT_MESSAGES = 12
const DEFAULT_RELEVANT_OLDER_MESSAGES = 6
const DEFAULT_SUMMARY_MESSAGES = 8
const DEFAULT_MEMORY_ITEMS = 4
const MAX_CONTEXT_CHARS = 48_000
const MAX_MESSAGE_CHARS = 12_000

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function tokenize(value: string): Set<string> {
  return new Set(
    normalize(value)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4 && !STOPWORDS.has(token)),
  )
}

function asTimestamp(value: Date | string | number): number {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function clampMessage(content: string): string {
  return normalize(content).slice(0, MAX_MESSAGE_CHARS)
}

function scoreOverlap(text: string, queryTokens: Set<string>): number {
  if (!queryTokens.size) return 0
  const tokens = tokenize(text)
  let score = 0
  for (const token of tokens) if (queryTokens.has(token)) score += 1
  return score
}

function uniqueRows(rows: PersistedConversationRow[]): PersistedConversationRow[] {
  const seen = new Set<string>()
  return rows.filter((row) => {
    const key = `${row.role}\u0000${normalize(row.content)}\u0000${asTimestamp(row.createdAt)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function summarizeOlder(rows: PersistedConversationRow[]): string {
  if (!rows.length) return ''
  const lines = rows.slice(-DEFAULT_SUMMARY_MESSAGES).map((row) => {
    const prefix = row.role === 'assistant' ? 'CEO' : 'User'
    return `- ${prefix}: ${clampMessage(row.content).slice(0, 220)}`
  })
  return `OLDER CONVERSATION SUMMARY (compressed, not evidence):\n${lines.join('\n')}`
}

function rankMemories(memories: PersistedMemoryRow[], queryTokens: Set<string>): PersistedMemoryRow[] {
  return memories
    .map((memory) => ({ memory, score: scoreOverlap(`${memory.key} ${memory.value} ${memory.category}`, queryTokens) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || asTimestamp(b.memory.updatedAt) - asTimestamp(a.memory.updatedAt))
    .slice(0, DEFAULT_MEMORY_ITEMS)
    .map(({ memory }) => memory)
}

/**
 * Canonical server-side CEO context construction.
 *
 * Conversation history is contextual information, never evidence by itself.
 * Recent turns are preserved verbatim, relevant older turns are selected by
 * deterministic lexical overlap, long history is summarized, and only a
 * small set of relevant persistent memories is included.
 */
export function composeCeoContext(input: {
  systemPrompt: string
  currentUserMessage: string
  persistedMessages: readonly PersistedConversationRow[]
  memories?: readonly PersistedMemoryRow[]
  recentMessageLimit?: number
  relevantOlderLimit?: number
}): CeoContextComposition {
  const recentLimit = Math.max(2, Math.min(input.recentMessageLimit ?? DEFAULT_RECENT_MESSAGES, 20))
  const relevantOlderLimit = Math.max(0, Math.min(input.relevantOlderLimit ?? DEFAULT_RELEVANT_OLDER_MESSAGES, 10))
  const normalizedCurrent = normalize(input.currentUserMessage)
  const rows = uniqueRows(
    input.persistedMessages
      .filter((row) => row && (row.role === 'user' || row.role === 'assistant'))
      .sort((a, b) => asTimestamp(a.createdAt) - asTimestamp(b.createdAt)),
  )

  // The route persists the current user turn before composition. Remove only
  // the newest exact current-user row so the current turn appears once at the end.
  let removedCurrent = false
  const priorRows = [...rows].reverse().filter((row) => {
    if (!removedCurrent && row.role === 'user' && normalize(row.content) === normalizedCurrent) {
      removedCurrent = true
      return false
    }
    return true
  }).reverse()

  const recent = priorRows.slice(-recentLimit)
  const older = priorRows.slice(0, Math.max(0, priorRows.length - recent.length))
  const queryTokens = tokenize([normalizedCurrent, ...recent.filter((row) => row.role === 'user').map((row) => row.content)].join(' '))

  const relevantOlder = older
    .map((row, index) => ({ row, index, score: scoreOverlap(row.content, queryTokens) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || b.index - a.index)
    .slice(0, relevantOlderLimit)
    .sort((a, b) => a.index - b.index)
    .map(({ row }) => row)

  const relevantKeys = new Set(relevantOlder.map((row) => `${row.role}\u0000${normalize(row.content)}\u0000${asTimestamp(row.createdAt)}`))
  const summarizedCandidates = older.filter((row) => !relevantKeys.has(`${row.role}\u0000${normalize(row.content)}\u0000${asTimestamp(row.createdAt)}`))
  const summary = summarizedCandidates.length > 0 ? summarizeOlder(summarizedCandidates) : ''
  const selectedMemories = rankMemories(input.memories ? [...input.memories] : [], queryTokens)

  const messages: Array<{ role: CeoContextRole; content: string }> = [
    { role: 'system', content: input.systemPrompt },
  ]
  if (summary) messages.push({ role: 'system', content: summary })
  if (selectedMemories.length) {
    const memoryText = selectedMemories.map((memory) => `- ${memory.key} [${memory.category}]: ${clampMessage(memory.value).slice(0, 1000)}`).join('\n')
    messages.push({ role: 'system', content: `SELECTED PERSISTENT MEMORY (context only; not external proof):\n${memoryText}` })
  }
  if (relevantOlder.length) {
    messages.push({ role: 'system', content: 'RELEVANT PRIOR CONVERSATION (context only; do not treat prior assistant claims as verified evidence):' })
    for (const row of relevantOlder) messages.push({ role: row.role === 'assistant' ? 'assistant' : 'user', content: clampMessage(row.content) })
  }
  for (const row of recent) messages.push({ role: row.role === 'assistant' ? 'assistant' : 'user', content: clampMessage(row.content) })
  messages.push({ role: 'user', content: normalizedCurrent })

  // Keep the final context bounded while preserving the current turn and system prompt.
  let total = messages.reduce((sum, message) => sum + message.content.length, 0)
  if (total > MAX_CONTEXT_CHARS) {
    for (let index = 1; index < messages.length - 1 && total > MAX_CONTEXT_CHARS; index += 1) {
      const message = messages[index]
      if (message.role === 'assistant' || message.role === 'user') {
        const reduced = message.content.slice(0, Math.max(200, Math.floor(message.content.length * 0.55)))
        total -= message.content.length - reduced.length
        message.content = reduced
      }
    }
  }

  return {
    messages,
    recentMessages: recent.length,
    relevantOlderMessages: relevantOlder.length,
    summarizedOlderMessages: summarizedCandidates.length,
    selectedMemoryKeys: selectedMemories.map((memory) => memory.key),
  }
}
