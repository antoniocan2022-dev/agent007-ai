import type { PersistedConversationRow } from './ceo-context-composer'
export type { PersistedConversationRow } from './ceo-context-composer'
import { containsInternalArtifactToken } from './ceo-behavioral-policy'
import { isCorrectionRequest } from './ceo-conversational-signals'
import { resolveActiveThread, resolveGeneralReference, resolveOrdinalReference, resolveTemporalReference, type ConversationReferenceKind, type ConversationThreadRecord, type ReferenceCandidate } from './ceo-reference-resolution'

export type ConversationTone = 'neutral' | 'friendly' | 'technical' | 'serious' | 'frustrated' | 'celebratory'
export interface CeoConversationState {
  schemaVersion: 4
  topic: string
  topicCandidates: string[]
  entities: string[]
  activeThreads: string[]
  threads: ConversationThreadRecord[]
  unresolvedQuestions: string[]
  decisions: string[]
  recentUserGoals: string[]
  recentCorrections: string[]
  tone: ConversationTone
  turnCount: number
  lastUserMessage: string
  lastAssistantMessage: string
  updatedAt: number
}
export interface ConversationReference {
  phrase: string
  kind: ConversationReferenceKind
  resolvedText: string | null
  confidence: number
  sourceRole?: 'user' | 'assistant'
  ambiguous: boolean
  candidates: ReferenceCandidate[]
}
const STOPWORDS = new Set(['about','after','again','also','because','before','being','between','could','from','have','into','more','most','other','should','that','their','there','these','they','this','those','through','under','what','when','where','which','while','with','would','your','please','then','than','just','like','really','very','doing','does','doesnt','dont','you','are','how','why','can','tell','give','make','want','were','will','been','them','theyre','same','option','thing','problem','issue'])
const QUESTION_RE = /\?\s*$|^(?:what|why|how|when|where|who|which|should|can|could|would|is|are|do|does)\b/i
const DECISION_RE = /\b(?:decided|decision|we(?:'ll|\s+will)|let'?s\s+(?:use|do|build|keep|choose)|agreed|selected|going\s+with|prefer(?:red)?|prioriti[sz]e|priorit(?:y|ies))\b/i
const CORRECTION_RE = /^\s*(?:no\b|that(?:'s| is)\s+(?:not|n't)\b|i\s+mean\b|what\s+i\s+meant\b|correction\b)/i
const GOAL_RE = /\b(?:main|primary|core|long[- ]term)\s+(?:goal|objective)\b|\b(?:our|the|my)\s+(?:goal|objective)\b|\bcenter\s+of\s+gravity\b/i
const RESOLUTION_RE = /\b(?:resolved|closed|finished|done|complete|completed|no longer|solved|fixed)\b/i
const SUPERSESSION_RE = /\b(?:instead|rather|forget that|move on|replace|supersede|switch to|new topic|different topic)\b/i
const ENTITY_RE = /\b(?:Agent007|CEO|Vercel|GitHub|OpenAI|Groq|Mistral|Cerebras|Cloudflare|OpenRouter|Context Composer|Conversation State|Memory|Revenue|Venture OS|Mission OS)\b/g
function normalize(value: string): string { return value.replace(/\s+/g, ' ').trim() }
function tokens(value: string): string[] { return [...new Set(normalize(value).toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 4 && !STOPWORDS.has(token)))] }
function timestamp(value: PersistedConversationRow['createdAt']): number { if (value instanceof Date) return value.getTime(); if (typeof value === 'number') return value; const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : 0 }
function isSafeConversationRow(row: PersistedConversationRow): boolean { if (!row || typeof row.content !== 'string') return false; if (row.role === 'user') return true; return row.role === 'assistant' && Boolean(row.content.trim()) && !containsInternalArtifactToken(row.content) }
export function safeConversationRows(rows: readonly PersistedConversationRow[]): PersistedConversationRow[] { return rows.filter(isSafeConversationRow) }
function toneOf(text: string): ConversationTone { const lower = text.toLowerCase(); if (/\b(angry|frustrated|waste|wasting|ridiculous|broken|disappointed|annoyed)\b/.test(lower)) return 'frustrated'; if (/\b(great|excellent|perfect|awesome|succeeded|success|finally)\b/.test(lower)) return 'celebratory'; if (/\b(code|github|vercel|architecture|deployment|database|typescript|api|provider|ci|sha)\b/.test(lower)) return 'technical'; if (/\b(hello|hi|hey|thanks|thank you|how are you)\b/.test(lower)) return 'friendly'; if (/\b(problem|issue|risk|failure|critical|security)\b/.test(lower)) return 'serious'; return 'neutral' }
function uniqueRecent(items: string[], max = 6): string[] { return [...new Set(items.map(normalize).filter(Boolean))].slice(-max) }
function overlap(a: string, b: string): number { const left = new Set(tokens(a)); const right = new Set(tokens(b)); if (!left.size || !right.size) return 0; let matches = 0; for (const token of left) if (right.has(token)) matches += 1; return matches / Math.max(1, Math.min(left.size, right.size)) }
function threadStatus(text: string, now: number, lastTouchedAt: number, hasNewerTopic: boolean): ConversationThreadRecord['status'] { if (RESOLUTION_RE.test(text)) return 'resolved'; if (SUPERSESSION_RE.test(text) || hasNewerTopic) return 'superseded'; if (now - lastTouchedAt > 1000 * 60 * 60 * 24 * 7) return 'paused'; return 'active' }
function buildThreads(rows: readonly PersistedConversationRow[], now = Date.now()): ConversationThreadRecord[] {
  const safeRows = safeConversationRows(rows)
  const users = safeRows.filter((row) => row.role === 'user' && row.content.trim().length > 15)
  const threads: ConversationThreadRecord[] = []
  const mergeInto = (thread: ConversationThreadRecord, content: string, topicTokens: string[], row: PersistedConversationRow) => {
    thread.currentObjective = content
    thread.topic = [...new Set([...tokens(thread.topic), ...topicTokens])].slice(0, 6).join(', ')
    thread.entities = [...new Set([...thread.entities, ...(content.match(ENTITY_RE) ?? [])])].slice(-12)
    if (QUESTION_RE.test(content)) thread.unresolvedQuestions = uniqueRecent([...thread.unresolvedQuestions, content], 4)
    if (DECISION_RE.test(content)) thread.decisions = uniqueRecent([...thread.decisions, content], 4)
    thread.lastTouchedAt = timestamp(row.createdAt)
    thread.status = threadStatus(content, now, thread.lastTouchedAt, false)
  }
  for (const row of users.slice(-24)) {
    const content = normalize(row.content)
    const topicTokens = tokens(content).slice(0, 8)
    const supersedes = SUPERSESSION_RE.test(content)
    const lexicalMatch = [...threads].reverse().find((thread) => overlap(thread.currentObjective, content) >= 0.25 && thread.status !== 'resolved' && thread.status !== 'abandoned')
    // Paused is a valid merge target here, not just active: resolveActiveThread (the consumer of
    // these threads) already treats active and paused as equally continuable, and threadStatus can
    // mark a thread paused purely from wall-clock age (>7 days since its last message) regardless of
    // whether this same processing pass is still mid-conversation on it. Without this, replaying or
    // deriving state for a conversation whose messages happen to straddle that age boundary silently
    // fragments one continuous topic into a new, disconnected thread per message.
    const currentActive = threads.find((thread) => thread.status === 'active' || thread.status === 'paused')
    if (!supersedes && lexicalMatch) mergeInto(lexicalMatch, content, topicTokens, row)
    else if (!supersedes && currentActive) mergeInto(currentActive, content, topicTokens, row)
    else {
      // Reaching this branch with supersedes===false requires currentActive to already be falsy
      // (that's the only way the "else if" above didn't take it), so the guard below only ever
      // fires for an explicit topic switch -- always 'superseded', never 'paused'.
      if (currentActive) currentActive.status = 'superseded'
      const id = `conversation-thread-${threads.length + 1}`
      const freshStatus = supersedes ? 'active' : threadStatus(content, now, timestamp(row.createdAt), false)
      threads.push({ id, title: content.slice(0, 80), topic: topicTokens.slice(0, 4).join(', ') || content.slice(0, 80), entities: [...new Set(content.match(ENTITY_RE) ?? [])], currentObjective: content, unresolvedQuestions: QUESTION_RE.test(content) ? [content] : [], decisions: DECISION_RE.test(content) ? [content] : [], lastTouchedAt: timestamp(row.createdAt), status: freshStatus })
    }
  }
  const assistantRows = safeRows.filter((row) => row.role === 'assistant').map((row) => ({ content: normalize(row.content), at: timestamp(row.createdAt) })).sort((a, b) => a.at - b.at)
  const mostRecentAssistantReply = assistantRows.at(-1)?.content
  for (const thread of threads) {
    // Same active-or-paused rule as the merge fallback above: a thread that crossed the wall-clock
    // pause threshold mid-derivation is still a legitimate continuation target, so it still deserves
    // its most recent reply attached rather than silently losing it.
    const isContinuable = thread.status === 'active' || thread.status === 'paused'
    const reply = assistantRows.find((entry) => entry.at > thread.lastTouchedAt)?.content ?? (isContinuable ? mostRecentAssistantReply : undefined)
    if (reply) thread.lastAssistantReply = reply
  }
  const newestTimestamp = Math.max(0, ...threads.map((thread) => thread.lastTouchedAt))
  for (const thread of threads) if (thread.status === 'active' && newestTimestamp - thread.lastTouchedAt > 1000 * 60 * 60 * 24 * 2) thread.status = 'paused'
  return threads.slice(-12)
}
export function deriveCeoConversationState(rows: readonly PersistedConversationRow[], currentUserMessage = ''): CeoConversationState {
  const clean = safeConversationRows(rows)
  const userRows = clean.filter((row) => row.role === 'user')
  const assistantRows = clean.filter((row) => row.role === 'assistant')
  const latest = normalize(currentUserMessage || userRows.at(-1)?.content || '')
  const corpus = clean.slice(-48).map((row) => row.content).join(' ')
  const counts = new Map<string, number>(); for (const token of tokens(corpus)) counts.set(token, (counts.get(token) ?? 0) + 1)
  const topicCandidates = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12).map(([token]) => token)
  const entities = [...new Set((corpus.match(ENTITY_RE) ?? []).map(normalize))]
  const threads = buildThreads(clean)
  const activeThreads = threads.filter((thread) => thread.status === 'active').sort((a, b) => b.lastTouchedAt - a.lastTouchedAt).slice(0, 5)
  const durableGoalRows = userRows.filter((row) => GOAL_RE.test(row.content)).map((row) => normalize(row.content))
  const durableGoals = uniqueRecent(durableGoalRows, 4)
  const recentGoalRows = uniqueRecent(userRows.slice(-8).map((row) => normalize(row.content)), Math.max(1, 8 - durableGoals.length))
  const recentUserGoals = uniqueRecent([...durableGoals, ...recentGoalRows], 8)
  const recentCorrections = uniqueRecent(userRows.filter((row) => isCorrectionRequest(row.content)).map((row) => normalize(row.content)), 6)
  const decisions = uniqueRecent(clean.filter((row) => DECISION_RE.test(row.content)).map((row) => normalize(row.content)), 6)
  const unresolvedQuestions = uniqueRecent(userRows.filter((row) => QUESTION_RE.test(row.content)).map((row) => normalize(row.content)), 6)
  return { schemaVersion: 4, topic: topicCandidates.slice(0, 4).join(', ') || entities.slice(-3).join(', ') || latest.slice(0, 120), topicCandidates, entities: entities.slice(-12), activeThreads: activeThreads.map((thread) => thread.title), threads, unresolvedQuestions, decisions, recentUserGoals, recentCorrections, tone: toneOf(latest || corpus.slice(-500)), turnCount: Math.ceil(clean.length / 2), lastUserMessage: latest, lastAssistantMessage: normalize(assistantRows.at(-1)?.content || ''), updatedAt: Date.now() }
}
export function resolveConversationReferences(currentMessage: string, rows: readonly PersistedConversationRow[], state?: CeoConversationState): ConversationReference[] {
  const message = normalize(currentMessage); if (!message) return []
  const safeRows = safeConversationRows(rows)
  const ordinal = resolveOrdinalReference(message, safeRows); if (ordinal) return [ordinal]
  const temporal = resolveTemporalReference(message, safeRows); if (temporal) return [temporal]
  const continuation = resolveActiveThread(message, state?.threads ?? []); if (continuation) return [continuation]
  const general = resolveGeneralReference(message, safeRows, state?.activeThreads?.at(-1)); return general ? [general] : []
}
export function buildConversationStatePrompt(state: CeoConversationState, references: ConversationReference[]): string {
  const referenceLines = references.map((ref) => `- \"${ref.phrase}\" [${ref.kind}] → ${ref.resolvedText ?? 'unresolved'} (${Math.round(ref.confidence * 100)}%${ref.ambiguous ? ', ambiguous' : ''})`)
  const threadLines = state.threads.slice(-6).map((thread) => `- ${thread.id}: ${thread.title} [${thread.status}]`)
  const toneInstruction = state.tone === 'technical' ? 'technical and direct' : state.tone === 'frustrated' ? 'calm, accountable, direct, and solution-focused' : state.tone === 'friendly' ? 'warm and conversational' : 'natural and context-aware'
  return ['CONVERSATION STATE (persistent derived state; preserve continuity; not factual evidence):', `Topic: ${state.topic || 'unknown'}`, `Related concepts: ${state.topicCandidates.join(', ') || 'none'}`, `Entities: ${state.entities.join(', ') || 'none'}`, `Active threads: ${state.activeThreads.join(' | ') || 'none'}`, `Recent thread records: ${threadLines.join(' | ') || 'none'}`, `User goals: ${state.recentUserGoals.join(' | ') || 'none'}`, `Open questions: ${state.unresolvedQuestions.join(' | ') || 'none'}`, `Prior decisions: ${state.decisions.join(' | ') || 'none'}`, `Recent corrections: ${state.recentCorrections.join(' | ') || 'none'}`, `Conversation turns represented: ${state.turnCount}`, `Current tone: ${state.tone}; respond in a ${toneInstruction} manner.`, ...(referenceLines.length ? ['Resolved conversational references:', ...referenceLines] : ['Resolved conversational references: none']), 'Communication rule: answer naturally first. Do not expose state, scores, routing, evidence state, or governance internals unless explicitly asked.'].join('\n')
}
export const buildCeoConversationStatePrompt = buildConversationStatePrompt
export function buildCeoPersonalityContract(): string {
  return ['CEO NATURAL CONVERSATION CONTRACT:', 'Speak like a capable, thoughtful executive partner rather than a form, auditor, or workflow engine.', 'Preserve context across turns, resolve references from conversation state, and avoid asking for information already available in context.', 'Match the user’s tone and desired depth. Be concise for simple conversation and deep when the user is exploring a difficult issue.', 'Do not add headings, evidence banners, quality labels, or procedural language to ordinary conversation.', 'Do not repeat the user’s question unnecessarily. Move the conversation forward with useful thought when appropriate.', 'Admit uncertainty naturally. Use explicit verification only when a claim actually needs fresh evidence or live system state.', 'When a request requires tools, evidence, or execution, perform the governed work internally and return the result in natural language.', 'Maintain a stable Agent007 identity across providers and fallback attempts.'].join(' ')
}
export function extractConversationAnchors(rows: readonly PersistedConversationRow[]): string[] { return safeConversationRows(rows).slice(-24).flatMap((row) => row.content.split(/[.!?]+/)).map(normalize).filter((clause) => clause.length >= 30).slice(-16) }
