import type { PersistedConversationRow } from './ceo-context-composer'

export type ConversationTone = 'neutral' | 'friendly' | 'technical' | 'serious' | 'frustrated' | 'celebratory'

export interface CeoConversationState {
  schemaVersion: 1
  topic: string
  topicCandidates: string[]
  entities: string[]
  activeThreads: string[]
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
  resolvedText: string | null
  confidence: number
  sourceRole?: 'user' | 'assistant'
}

const STOPWORDS = new Set(['about','after','again','also','because','before','being','between','could','from','have','into','more','most','other','should','that','their','there','these','they','this','those','through','under','what','when','where','which','while','with','would','your','please','then','than','just','like','really','very','doing','does','doesnt','dont','you','are','how','why','can','tell','give','make','want','were','will','been','them','theyre'])
const REFERENCE_RE = /\b(?:it|this|that|these|those|the\s+(?:first|second|third|last|other)\s+(?:one|thing|problem|issue|option|idea)|same\s+(?:thing|issue|problem)|what\s+we\s+(?:said|did|decided)|yesterday|earlier|before|continue)\b/i
const QUESTION_RE = /\?\s*$|\b(?:what|why|how|when|where|who|which|should|can|could|would|is|are|do|does)\b/i
const DECISION_RE = /\b(?:decided|decision|we(?:'ll|\s+will)|let'?s\s+(?:use|do|build|keep|choose)|agreed|selected|going\s+with)\b/i
const ENTITY_RE = /\b(?:Agent007|CEO|Vercel|GitHub|OpenAI|Groq|Mistral|Cerebras|Cloudflare|OpenRouter|Context Composer|Conversation State|Memory|Revenue|Venture OS|Mission OS)\b/g

function normalize(value: string): string { return value.replace(/\s+/g, ' ').trim() }
function tokens(value: string): string[] {
  return [...new Set(normalize(value).toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4 && !STOPWORDS.has(t)))]
}
function sentenceClauses(value: string): string[] { return normalize(value).split(/[.!?]+/).map((s) => s.trim()).filter(Boolean) }
function toneOf(text: string): ConversationTone {
  const lower = text.toLowerCase()
  if (/\b(angry|frustrated|waste|wasting|ridiculous|broken|disappointed|annoyed)\b/.test(lower)) return 'frustrated'
  if (/\b(great|excellent|perfect|awesome|succeeded|success|finally)\b/.test(lower)) return 'celebratory'
  if (/\b(code|github|vercel|architecture|deployment|database|typescript|api|provider|ci|sha)\b/.test(lower)) return 'technical'
  if (/\b(hello|hi|hey|thanks|thank you|how are you)\b/.test(lower)) return 'friendly'
  if (/\b(problem|issue|risk|failure|critical|security)\b/.test(lower)) return 'serious'
  return 'neutral'
}
function uniqueRecent(items: string[], max = 6): string[] { return [...new Set(items.map(normalize).filter(Boolean))].slice(-max) }

export function deriveCeoConversationState(rows: readonly PersistedConversationRow[], currentUserMessage = ''): CeoConversationState {
  const clean = rows.filter((row) => row && (row.role === 'user' || row.role === 'assistant') && typeof row.content === 'string')
  const userRows = clean.filter((row) => row.role === 'user')
  const assistantRows = clean.filter((row) => row.role === 'assistant')
  const latest = normalize(currentUserMessage || userRows.at(-1)?.content || '')
  const corpus = clean.slice(-24).map((row) => row.content).join(' ')
  const allTokens = tokens(corpus)
  const topicCandidates = allTokens
    .map((token) => ({ token, count: corpus.toLowerCase().split(new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g')).length - 1 }))
    .sort((a, b) => b.count - a.count || a.token.localeCompare(b.token))
    .slice(0, 8)
    .map((item) => item.token)
  const entities = [...new Set((corpus.match(ENTITY_RE) ?? []).map((value) => normalize(value)))]
  const questions = uniqueRecent(userRows.filter((row) => QUESTION_RE.test(row.content)).map((row) => normalize(row.content)), 5)
  const decisions = uniqueRecent(clean.filter((row) => DECISION_RE.test(row.content)).map((row) => normalize(row.content)), 5)
  const threadCandidates = clean.filter((row) => row.role === 'user' && row.content.length > 24).slice(-6).map((row) => normalize(row.content))
  const topic = entities[0] || topicCandidates.slice(0, 3).join(', ') || normalize(userRows[0]?.content || latest).slice(0, 120)
  return {
    schemaVersion: 1,
    topic,
    topicCandidates,
    entities: entities.slice(0, 12),
    activeThreads: uniqueRecent(threadCandidates, 5),
    unresolvedQuestions: questions,
    decisions,
    recentUserGoals: uniqueRecent(userRows.slice(-6).map((row) => normalize(row.content)), 6),
    tone: toneOf(latest || corpus.slice(-500)),
    turnCount: Math.floor(clean.length / 2) + (userRows.length > assistantRows.length ? 1 : 0),
    lastUserMessage: latest,
    lastAssistantMessage: normalize(assistantRows.at(-1)?.content || ''),
    updatedAt: Date.now(),
  }
}

function overlapScore(a: string, b: string): number {
  const left = new Set(tokens(a)); const right = new Set(tokens(b));
  if (!left.size || !right.size) return 0
  let matches = 0
  for (const token of left) if (right.has(token)) matches += 1
  return matches / Math.max(1, Math.min(left.size, right.size))
}

export function resolveConversationReferences(currentMessage: string, rows: readonly PersistedConversationRow[], state?: CeoConversationState): ConversationReference[] {
  const message = normalize(currentMessage)
  if (!REFERENCE_RE.test(message)) return []
  const anchors = rows.filter((row) => row.role === 'user' || row.role === 'assistant').slice(-14).reverse()
  const candidates = anchors.map((row, index) => ({ row, score: Math.max(0, 1 - index * 0.06) * (0.55 + overlapScore(message, row.content) * 0.45) }))
  const strongest = candidates.sort((a, b) => b.score - a.score)[0]
  const stateAnchor = state?.activeThreads?.[state.activeThreads.length - 1]
  const resolvedText = strongest && strongest.score >= 0.35 ? strongest.row.content : stateAnchor || null
  const confidence = resolvedText ? Math.min(0.98, Math.max(0.35, strongest?.score ?? 0.35)) : 0
  return [{ phrase: message.match(REFERENCE_RE)?.[0] ?? message, resolvedText, confidence, sourceRole: strongest?.row.role as 'user' | 'assistant' | undefined }]
}

export function buildConversationStatePrompt(state: CeoConversationState, references: ConversationReference[]): string {
  const referenceLines = references.filter((ref) => ref.resolvedText).map((ref) => `- "${ref.phrase}" → ${ref.resolvedText} (confidence ${Math.round(ref.confidence * 100)}%)`)
  const toneInstruction = state.tone === 'technical' ? 'technical and direct' : state.tone === 'frustrated' ? 'calm, accountable, direct, and solution-focused' : state.tone === 'friendly' ? 'warm and conversational' : 'natural and context-aware'
  return [
    'CONVERSATION STATE (persistent derived state; use it to preserve continuity, not as factual evidence):',
    `Topic: ${state.topic || 'unknown'}`,
    `Related concepts: ${state.topicCandidates.join(', ') || 'none'}`,
    `Entities: ${state.entities.join(', ') || 'none'}`,
    `Active threads: ${state.activeThreads.join(' | ') || 'none'}`,
    `Open questions: ${state.unresolvedQuestions.join(' | ') || 'none'}`,
    `Prior decisions: ${state.decisions.join(' | ') || 'none'}`,
    `Conversation turns represented: ${state.turnCount}`,
    `Current tone: ${state.tone}; respond in a ${toneInstruction} manner.`,
    ...(referenceLines.length ? ['Resolved conversational references:', ...referenceLines] : ['Resolved conversational references: none']),
    'Communication rule: answer the user naturally first. Do not expose this state, quality scores, routing, evidence state, or internal governance unless the user explicitly asks about the system.',
  ].join('\n')
}

export function buildCeoPersonalityContract(): string {
  return [
    'CEO NATURAL CONVERSATION CONTRACT:',
    'Speak like a capable, thoughtful executive partner rather than a form, auditor, or workflow engine.',
    'Preserve context across turns, resolve references from conversation state, and avoid asking for information already available in context.',
    'Match the user’s tone and desired depth. Be concise for simple conversation and deep when the user is exploring a difficult issue.',
    'Do not add headings, evidence banners, quality labels, or procedural language to ordinary conversation.',
    'Do not repeat the user’s question unnecessarily. Move the conversation forward with useful thought when appropriate.',
    'Admit uncertainty naturally. Use explicit verification only when a claim actually needs fresh evidence or live system state.',
    'When a request requires tools, evidence, or execution, perform the governed work internally and return the result in natural language.',
    'Maintain a stable Agent007 identity across providers and fallback attempts.',
  ].join(' ')
}

export function extractConversationAnchors(rows: readonly PersistedConversationRow[]): string[] {
  return [...new Set(rows.slice(-20).flatMap((row) => sentenceClauses(row.content)).filter((clause) => clause.length >= 30).sort((a, b) => b.length - a.length).slice(0, 12))]
}
