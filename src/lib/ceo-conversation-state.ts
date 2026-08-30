import type { PersistedConversationRow } from './ceo-context-composer'
import { resolveActiveThread, resolveGeneralReference, resolveOrdinalReference, resolveTemporalReference, type ConversationReferenceKind, type ConversationThreadRecord, type ReferenceCandidate } from './ceo-reference-resolution'

export type ConversationTone = 'neutral' | 'friendly' | 'technical' | 'serious' | 'frustrated' | 'celebratory'
export interface CeoConversationState {
  schemaVersion: 2
  topic: string
  topicCandidates: string[]
  entities: string[]
  activeThreads: string[]
  threads: ConversationThreadRecord[]
  unresolvedQuestions: string[]
  decisions: string[]
  recentUserGoals: string[]
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
const STOPWORDS = new Set(['about','after','again','also','because','before','being','between','could','from','have','into','more','most','other','should','that','their','there','these','they','this','those','through','under','what','when','where','which','while','with','would','your','please','then','than','just','like','really','very','doing','does','doesnt','dont','you','are','how','why','can','tell','give','make','want','were','will','been','them','theyre'])
const QUESTION_RE = /\?\s*$|\b(?:what|why|how|when|where|who|which|should|can|could|would|is|are|do|does)\b/i
const DECISION_RE = /\b(?:decided|decision|we(?:'ll|\s+will)|let'?s\s+(?:use|do|build|keep|choose)|agreed|selected|going\s+with)\b/i
const ENTITY_RE = /\b(?:Agent007|CEO|Vercel|GitHub|OpenAI|Groq|Mistral|Cerebras|Cloudflare|OpenRouter|Context Composer|Conversation State|Memory|Revenue|Venture OS|Mission OS)\b/g
function normalize(value: string): string { return value.replace(/\s+/g, ' ').trim() }
function tokens(value: string): string[] { return [...new Set(normalize(value).toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 4 && !STOPWORDS.has(token)))] }
function timestamp(value: PersistedConversationRow['createdAt']): number { if (value instanceof Date) return value.getTime(); if (typeof value === 'number') return value; const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : 0 }
function toneOf(text: string): ConversationTone { const lower = text.toLowerCase(); if (/\b(angry|frustrated|waste|wasting|ridiculous|broken|disappointed|annoyed)\b/.test(lower)) return 'frustrated'; if (/\b(great|excellent|perfect|awesome|succeeded|success|finally)\b/.test(lower)) return 'celebratory'; if (/\b(code|github|vercel|architecture|deployment|database|typescript|api|provider|ci|sha)\b/.test(lower)) return 'technical'; if (/\b(hello|hi|hey|thanks|thank you|how are you)\b/.test(lower)) return 'friendly'; if (/\b(problem|issue|risk|failure|critical|security)\b/.test(lower)) return 'serious'; return 'neutral' }
function uniqueRecent(items: string[], max = 6): string[] { return [...new Set(items.map(normalize).filter(Boolean))].slice(-max) }
function buildThreads(rows: readonly PersistedConversationRow[]): ConversationThreadRecord[] {
  return rows.filter((row) => row.role === 'user' && row.content.trim().length > 24).slice(-8).map((row, index) => { const content = normalize(row.content); return { id: `conversation-thread-${index + 1}`, title: content.slice(0, 80), topic: tokens(content).slice(0, 3).join(', ') || content.slice(0, 80), entities: [...new Set(content.match(ENTITY_RE) ?? [])], currentObjective: content, unresolvedQuestions: QUESTION_RE.test(content) ? [content] : [], decisions: DECISION_RE.test(content) ? [content] : [], lastTouchedAt: timestamp(row.createdAt), status: 'active' as const } })
}
export function deriveCeoConversationState(rows: readonly PersistedConversationRow[], currentUserMessage = ''): CeoConversationState {
  const clean = rows.filter((row) => row && (row.role === 'user' || row.role === 'assistant') && typeof row.content === 'string')
  const userRows = clean.filter((row) => row.role === 'user')
  const assistantRows = clean.filter((row) => row.role === 'assistant')
  const latest = normalize(currentUserMessage || userRows.at(-1)?.content || '')
  const corpus = clean.slice(-32).map((row) => row.content).join(' ')
  const counts = new Map<string, number>(); for (const token of tokens(corpus)) counts.set(token, (counts.get(token) ?? 0) + 1)
  const topicCandidates = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10).map(([token]) => token)
  const entities = [...new Set((corpus.match(ENTITY_RE) ?? []).map(normalize))]
  const threads = buildThreads(clean)
  return { schemaVersion: 2, topic: topicCandidates.slice(0, 4).join(', ') || entities.slice(-3).join(', ') || latest.slice(0, 120), topicCandidates, entities: entities.slice(-12), activeThreads: threads.filter((thread) => thread.status === 'active').slice(-5).map((thread) => thread.title), threads, unresolvedQuestions: uniqueRecent(userRows.filter((row) => QUESTION_RE.test(row.content)).map((row) => normalize(row.content)), 6), decisions: uniqueRecent(clean.filter((row) => DECISION_RE.test(row.content)).map((row) => normalize(row.content)), 6), recentUserGoals: uniqueRecent(userRows.slice(-8).map((row) => normalize(row.content)), 8), tone: toneOf(latest || corpus.slice(-500)), turnCount: Math.ceil(clean.length / 2), lastUserMessage: latest, lastAssistantMessage: normalize(assistantRows.at(-1)?.content || ''), updatedAt: Date.now() }
}
export function resolveConversationReferences(currentMessage: string, rows: readonly PersistedConversationRow[], state?: CeoConversationState): ConversationReference[] {
  const message = normalize(currentMessage); if (!message) return []
  const ordinal = resolveOrdinalReference(message, rows); if (ordinal) return [ordinal]
  const temporal = resolveTemporalReference(message, rows); if (temporal) return [temporal]
  const continuation = resolveActiveThread(message, state?.threads ?? []); if (continuation) return [continuation]
  const general = resolveGeneralReference(message, rows, state?.activeThreads?.at(-1)); return general ? [general] : []
}
export function buildConversationStatePrompt(state: CeoConversationState, references: ConversationReference[]): string {
  const referenceLines = references.map((ref) => `- \"${ref.phrase}\" [${ref.kind}] → ${ref.resolvedText ?? 'unresolved'} (${Math.round(ref.confidence * 100)}%${ref.ambiguous ? ', ambiguous' : ''})`)
  const threadLines = state.threads.slice(-5).map((thread) => `- ${thread.id}: ${thread.title} [${thread.status}]`)
  const toneInstruction = state.tone === 'technical' ? 'technical and direct' : state.tone === 'frustrated' ? 'calm, accountable, direct, and solution-focused' : state.tone === 'friendly' ? 'warm and conversational' : 'natural and context-aware'
  return ['CONVERSATION STATE (persistent derived state; preserve continuity; not factual evidence):', `Topic: ${state.topic || 'unknown'}`, `Related concepts: ${state.topicCandidates.join(', ') || 'none'}`, `Entities: ${state.entities.join(', ') || 'none'}`, `Active threads: ${state.activeThreads.join(' | ') || 'none'}`, `Recent thread records: ${threadLines.join(' | ') || 'none'}`, `Open questions: ${state.unresolvedQuestions.join(' | ') || 'none'}`, `Prior decisions: ${state.decisions.join(' | ') || 'none'}`, `Conversation turns represented: ${state.turnCount}`, `Current tone: ${state.tone}; respond in a ${toneInstruction} manner.`, ...(referenceLines.length ? ['Resolved conversational references:', ...referenceLines] : ['Resolved conversational references: none']), 'Communication rule: answer naturally first. Do not expose state, scores, routing, evidence state, or governance internals unless explicitly asked.'].join('\n')
}
export const buildCeoConversationStatePrompt = buildConversationStatePrompt
export function buildCeoPersonalityContract(): string {
  return ['CEO NATURAL CONVERSATION CONTRACT:', 'Speak like a capable, thoughtful executive partner rather than a form, auditor, or workflow engine.', 'Preserve context across turns, resolve references from conversation state, and avoid asking for information already available in context.', 'Match the user’s tone and desired depth. Be concise for simple conversation and deep when the user is exploring a difficult issue.', 'Do not add headings, evidence banners, quality labels, or procedural language to ordinary conversation.', 'Do not repeat the user’s question unnecessarily. Move the conversation forward with useful thought when appropriate.', 'Admit uncertainty naturally. Use explicit verification only when a claim actually needs fresh evidence or live system state.', 'When a request requires tools, evidence, or execution, perform the governed work internally and return the result in natural language.', 'Maintain a stable Agent007 identity across providers and fallback attempts.'].join(' ')
}
export function extractConversationAnchors(rows: readonly PersistedConversationRow[]): string[] { return [...new Set(rows.slice(-20).flatMap((row) => row.content.split(/[.!?]+/)).map(normalize).filter((clause) => clause.length >= 30))].slice(-12) }
