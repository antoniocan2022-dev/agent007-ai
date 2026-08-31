import { getCanonicalOrganizationPrompt } from '@/lib/canonical-organization-prompt'
import { buildCeoConversationStatePrompt, buildCeoPersonalityContract, deriveCeoConversationState, resolveConversationReferences, type CeoConversationState } from './ceo-conversation-state'
import { buildCanonicalConversationContext, renderCanonicalConversationContext, type CanonicalConversationContext } from './ceo-cognitive-conversation'

export type CeoContextRole = 'system' | 'user' | 'assistant'
export type CeoContextModuleName = 'organization' | 'evidence' | 'mission' | 'memory' | 'execution' | 'conversation' | 'conversation_state' | 'cognitive_context'

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
  modules: CeoContextModuleName[]
  conversationState: CeoConversationState
  canonicalSemanticContext: CanonicalConversationContext
  resolvedReferences: string[]
}

export interface CeoContextModules {
  organization?: string
  evidence?: string
  mission?: string
  memory?: string
  execution?: string
}

export interface CeoContextModulePolicyInput {
  intent: string
  missionRelevant: boolean
  evidenceClass: string
  taskClass?: string
  executionRequirement: string
  evidence?: string
  mission?: string
  memory?: string
  execution?: string
}

export function buildCeoContextModules(input: CeoContextModulePolicyInput): CeoContextModules {
  const taskClass = input.taskClass ?? ''
  const includeOrganization = input.intent !== 'conversation'
    || input.missionRelevant
    || input.evidenceClass !== 'none'
    || taskClass === 'financial'
    || input.executionRequirement === 'production'
  return {
    organization: includeOrganization ? getCanonicalOrganizationPrompt() : undefined,
    evidence: input.evidence?.trim() || undefined,
    mission: input.mission?.trim() || undefined,
    memory: input.memory?.trim() || undefined,
    execution: input.execution?.trim() || undefined,
  }
}

const STOPWORDS = new Set([
  'about', 'after', 'again', 'also', 'because', 'before', 'being', 'between', 'could', 'from',
  'have', 'into', 'more', 'most', 'other', 'should', 'that', 'their', 'there', 'these', 'they',
  'this', 'those', 'through', 'under', 'what', 'when', 'where', 'which', 'while', 'with', 'would',
  'your', 'agent007', 'please', 'then', 'than', 'just', 'like', 'really', 'very', 'doing', 'does',
  'doesnt', 'dont', 'you', 'are', 'how', 'why', 'can', 'tell', 'give', 'make', 'want',
])

const DEFAULT_RECENT_MESSAGES = 16
const DEFAULT_RELEVANT_OLDER_MESSAGES = 8
const DEFAULT_SUMMARY_MESSAGES = 10
const DEFAULT_MEMORY_ITEMS = 6
const MAX_CONTEXT_CHARS = 48_000
const MAX_MESSAGE_CHARS = 12_000

function normalize(value: string): string { return value.replace(/\s+/g, ' ').trim() }
function tokenize(value: string): Set<string> {
  return new Set(normalize(value).toLowerCase().split(/[^a-z0-9]+/).map((token) => token.trim()).filter((token) => token.length >= 4 && !STOPWORDS.has(token)))
}
function asTimestamp(value: Date | string | number): number {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}
function clampMessage(content: string): string { return normalize(content).slice(0, MAX_MESSAGE_CHARS) }
function scoreOverlap(text: string, queryTokens: Set<string>): number {
  if (!queryTokens.size) return 0
  let score = 0
  for (const token of tokenize(text)) if (queryTokens.has(token)) score += 1
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
  const lines = rows.slice(-DEFAULT_SUMMARY_MESSAGES).map((row) => `- ${row.role === 'assistant' ? 'CEO' : 'User'}: ${clampMessage(row.content).slice(0, 280)}`)
  return `OLDER CONVERSATION SUMMARY (compressed, context only; not evidence):\n${lines.join('\n')}`
}
function rankMemories(memories: PersistedMemoryRow[], queryTokens: Set<string>): PersistedMemoryRow[] {
  return memories
    .map((memory) => ({ memory, score: scoreOverlap(`${memory.key} ${memory.value} ${memory.category}`, queryTokens) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || asTimestamp(b.memory.updatedAt) - asTimestamp(a.memory.updatedAt))
    .slice(0, DEFAULT_MEMORY_ITEMS)
    .map(({ memory }) => memory)
}

function buildConversationModule(input: {
  currentUserMessage: string
  persistedMessages: readonly PersistedConversationRow[]
  recentMessageLimit: number
  relevantOlderLimit: number
}): { messages: Array<{ role: CeoContextRole; content: string }>; recent: PersistedConversationRow[]; relevantOlder: PersistedConversationRow[]; summarizedCount: number } {
  const normalizedCurrent = normalize(input.currentUserMessage)
  const rows = uniqueRows(input.persistedMessages.filter((row) => row && (row.role === 'user' || row.role === 'assistant')).sort((a, b) => asTimestamp(a.createdAt) - asTimestamp(b.createdAt)))
  let removedCurrent = false
  const priorRows = [...rows].reverse().filter((row) => {
    if (!removedCurrent && row.role === 'user' && normalize(row.content) === normalizedCurrent) {
      removedCurrent = true
      return false
    }
    return true
  }).reverse()
  const recent = priorRows.slice(-input.recentMessageLimit)
  const older = priorRows.slice(0, Math.max(0, priorRows.length - recent.length))
  const queryTokens = tokenize([normalizedCurrent, ...recent.filter((row) => row.role === 'user').map((row) => row.content)].join(' '))
  const relevantOlder = older.map((row, index) => ({ row, index, score: scoreOverlap(row.content, queryTokens) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || b.index - a.index)
    .slice(0, input.relevantOlderLimit)
    .sort((a, b) => a.index - b.index)
    .map(({ row }) => row)
  const relevantKeys = new Set(relevantOlder.map((row) => `${row.role}\u0000${normalize(row.content)}\u0000${asTimestamp(row.createdAt)}`))
  const summarizedCandidates = older.filter((row) => !relevantKeys.has(`${row.role}\u0000${normalize(row.content)}\u0000${asTimestamp(row.createdAt)}`))
  const messages: Array<{ role: CeoContextRole; content: string }> = []
  const summary = summarizedCandidates.length ? summarizeOlder(summarizedCandidates) : ''
  if (summary) messages.push({ role: 'system', content: summary })
  if (relevantOlder.length) {
    messages.push({ role: 'system', content: 'RELEVANT PRIOR CONVERSATION (context only; previous assistant claims are not factual proof):' })
    for (const row of relevantOlder) messages.push({ role: row.role === 'assistant' ? 'assistant' : 'user', content: clampMessage(row.content) })
  }
  for (const row of recent) messages.push({ role: row.role === 'assistant' ? 'assistant' : 'user', content: clampMessage(row.content) })
  messages.push({ role: 'user', content: normalizedCurrent })
  return { messages, recent, relevantOlder, summarizedCount: summarizedCandidates.length }
}

export function composeCeoContext(input: {
  systemPrompt: string
  currentUserMessage: string
  persistedMessages: readonly PersistedConversationRow[]
  memories?: readonly PersistedMemoryRow[]
  modules?: CeoContextModules
  recentMessageLimit?: number
  relevantOlderLimit?: number
}): CeoContextComposition {
  const recentLimit = Math.max(4, Math.min(input.recentMessageLimit ?? DEFAULT_RECENT_MESSAGES, 24))
  const relevantOlderLimit = Math.max(0, Math.min(input.relevantOlderLimit ?? DEFAULT_RELEVANT_OLDER_MESSAGES, 12))
  const conversation = buildConversationModule({ currentUserMessage: input.currentUserMessage, persistedMessages: input.persistedMessages, recentMessageLimit: recentLimit, relevantOlderLimit })
  const conversationState = deriveCeoConversationState(input.persistedMessages, input.currentUserMessage)
  const references = resolveConversationReferences(input.currentUserMessage, input.persistedMessages, conversationState)
  const queryTokens = tokenize([input.currentUserMessage, ...conversation.recent.filter((row) => row.role === 'user').map((row) => row.content), conversationState.topic, ...conversationState.entities].join(' '))
  const selectedMemories = rankMemories(input.memories ? [...input.memories] : [], queryTokens)
  const canonicalSemanticContext = buildCanonicalConversationContext({ currentMessage: input.currentUserMessage, rows: input.persistedMessages, state: conversationState, references, memories: selectedMemories })
  const messages: Array<{ role: CeoContextRole; content: string }> = [{ role: 'system', content: `${input.systemPrompt}\n\n${buildCeoPersonalityContract()}` }]
  const modules: CeoContextModuleName[] = ['conversation', 'conversation_state', 'cognitive_context']

  messages.push({ role: 'system', content: renderCanonicalConversationContext(canonicalSemanticContext) })
  messages.push({ role: 'system', content: buildCeoConversationStatePrompt(conversationState, references) })
  if (input.modules?.organization?.trim()) { messages.push({ role: 'system', content: `ORGANIZATION CONTEXT (conditional):\n${input.modules.organization.trim()}` }); modules.push('organization') }
  if (input.modules?.mission?.trim()) { messages.push({ role: 'system', content: `MISSION CONTEXT (conditional):\n${input.modules.mission.trim()}` }); modules.push('mission') }
  if (input.modules?.evidence?.trim()) { messages.push({ role: 'system', content: `EVIDENCE CONTEXT (separate from conversation; provenance required):\n${input.modules.evidence.trim()}` }); modules.push('evidence') }
  if (input.modules?.execution?.trim()) { messages.push({ role: 'system', content: `EXECUTION CONTEXT (internal execution result; do not treat as external evidence):\n${input.modules.execution.trim()}` }); modules.push('execution') }
  if (selectedMemories.length || input.modules?.memory?.trim()) {
    const selectedMemoryText = selectedMemories.map((memory) => `- ${memory.key} [${memory.category}]: ${clampMessage(memory.value).slice(0, 1200)}`).join('\n')
    const suppliedMemory = input.modules?.memory?.trim() ? `\n${input.modules.memory.trim()}` : ''
    messages.push({ role: 'system', content: `SELECTED MEMORY (context only; not factual proof):${selectedMemoryText ? `\n${selectedMemoryText}` : ''}${suppliedMemory}` })
    modules.push('memory')
  }
  messages.push(...conversation.messages)

  let total = messages.reduce((sum, message) => sum + message.content.length, 0)
  const currentIndex = messages.length - 1
  if (total > MAX_CONTEXT_CHARS) {
    for (let index = 1; index < currentIndex && total > MAX_CONTEXT_CHARS; index += 1) {
      const message = messages[index]
      if (message && (message.role === 'assistant' || message.role === 'user')) {
        const reduced = message.content.slice(0, Math.max(400, Math.floor(message.content.length * 0.62)))
        total -= message.content.length - reduced.length
        message.content = reduced
      }
    }
  }

  return {
    messages,
    recentMessages: conversation.recent.length,
    relevantOlderMessages: conversation.relevantOlder.length,
    summarizedOlderMessages: conversation.summarizedCount,
    selectedMemoryKeys: selectedMemories.map((memory) => memory.key),
    modules,
    conversationState,
    canonicalSemanticContext,
    resolvedReferences: references.filter((reference) => reference.resolvedText).map((reference) => `${reference.phrase} → ${reference.resolvedText}`),
  }
}
