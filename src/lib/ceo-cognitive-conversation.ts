import type { PersistedConversationRow, PersistedMemoryRow } from './ceo-context-composer'
import type { CeoConversationState, ConversationReference } from './ceo-conversation-state'
import { buildConversationDecisionContract, renderConversationDecisionContract } from './ceo-conversation-decision-contract'

export type CognitiveDepth = 'direct' | 'contextual' | 'deep' | 'strategic'
export type ReferenceScope = 'none' | 'same_turn' | 'cross_turn' | 'mixed'

export interface ConversationalWorldModel {
  schemaVersion: 1
  workingTopic: string
  subtopics: string[]
  userGoals: string[]
  decisions: string[]
  commitments: string[]
  openLoops: string[]
  activeThreads: string[]
  importantEntities: string[]
  recentCorrections: string[]
  durableMemoryKeys: string[]
}

export interface CanonicalConversationContext {
  schemaVersion: 1
  currentMessage: string
  intentHint: 'conversation' | 'analysis' | 'decision' | 'research' | 'action' | 'unknown'
  speechAct: 'social' | 'question' | 'proposition' | 'continuation' | 'correction' | 'request' | 'unknown'
  cognitiveDepth: CognitiveDepth
  referenceScope: ReferenceScope
  references: readonly ConversationReference[]
  worldModel: ConversationalWorldModel
  state: CeoConversationState
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function unique(items: readonly string[], max = 8): string[] {
  return [...new Set(items.map(normalize).filter(Boolean))].slice(-max)
}

function userIntentHint(message: string): CanonicalConversationContext['intentHint'] {
  const text = message.trim().toLowerCase()
  if (/\b(?:deploy|publish|ship|execute|send|create|delete|update|schedule)\b/.test(text)) return 'action'
  if (/\b(?:research|look\s+up|find\s+out|verify|fact[- ]check)\b/.test(text)) return 'research'
  if (/\b(?:choose|pick|decide|recommend|should\s+i|should\s+we)\b/.test(text)) return 'decision'
  if (/\b(?:analy[sz]e|analysis|compare|assess|evaluate|diagnose|strategy)\b/.test(text)) return 'analysis'
  return 'conversation'
}

function speechAct(message: string): CanonicalConversationContext['speechAct'] {
  const text = message.trim()
  if (/^(?:hi|hello|hey|good\s+(?:morning|afternoon|evening)|thanks?|thank\s+you|ok(?:ay)?|great|perfect)[\s!.?]*$/i.test(text)) return 'social'
  if (/\b(?:continue|go\s+back|return\s+to|same\s+as\s+before)\b/i.test(text) || /\bthe\s+(?:first|second|third|last|other)\b/i.test(text)) return 'continuation'
  if (/^(?:no|that's not|that isn't|i mean|what i meant|correction)\b/i.test(text)) return 'correction'
  if (text.endsWith('?')) return 'question'
  if (/\b(?:please|let's|lets|i want|i need|can you|could you|would you)\b/i.test(text)) return 'request'
  if (text.length >= 12) return 'proposition'
  return 'unknown'
}

function hasExplicitDepthSignal(message: string): boolean {
  return /\b(?:deep|deeply|comprehensive|comprehensively|thorough|thoroughly|in[- ]depth|stress[- ]test|root\s+cause|architecture|trade[- ]offs?|strategy|strategic|long[- ]term)\b/i.test(message)
}

export function classifyCognitiveDepth(message: string, state: CeoConversationState, referenceCount: number): CognitiveDepth {
  const text = message.toLowerCase()
  if (/\b(?:decide|decision|recommend|trade[- ]off|strategy|strategic|root\s+cause|architecture|compare|evaluate)\b/.test(text) || hasExplicitDepthSignal(message)) return 'strategic'
  if (state.turnCount >= 20 || referenceCount >= 2) return 'deep'
  if (referenceCount > 0 || state.turnCount > 2 || /\b(?:why|how|which|what)\b/.test(text)) return 'contextual'
  return 'direct'
}

export function classifyCognitiveDepthFromMessages(message: string, priorTurnCount: number, referenceCount: number): CognitiveDepth {
  const safeTurns = Math.max(0, Math.floor(priorTurnCount))
  const text = message.trim()
  if (/\b(?:decide|decision|recommend|trade[- ]offs?|strategy|strategic|root\s+cause|architecture|compare|evaluate|assess)\b/i.test(text) || hasExplicitDepthSignal(text)) return 'strategic'
  if (safeTurns >= 20 || referenceCount >= 2) return 'deep'
  if (referenceCount > 0 || safeTurns >= 2 || /\b(?:why|how|which|what)\b/i.test(text)) return 'contextual'
  return 'direct'
}

function referenceScope(references: readonly ConversationReference[], currentMessage: string): ReferenceScope {
  if (!references.length) return 'none'
  const hasSameTurn = /\b(?:it|they|them|this|that|these|those)\b/i.test(currentMessage) && /\b(?:and|,|both|each)\b/i.test(currentMessage)
  const hasCrossTurn = references.some((reference) => Boolean(reference.resolvedText))
  if (hasSameTurn && hasCrossTurn) return 'mixed'
  return hasSameTurn ? 'same_turn' : 'cross_turn'
}

function buildWorldModel(state: CeoConversationState, memories: readonly PersistedMemoryRow[], rows: readonly PersistedConversationRow[]): ConversationalWorldModel {
  const userGoals = unique(state.recentUserGoals, 8)
  const decisions = unique(state.decisions, 8)
  const commitments = unique(rows.filter((row) => row.role === 'user' && /\b(?:i will|we will|let's|lets|we're going to|i'm going to)\b/i.test(row.content)).map((row) => row.content), 6)
  const openLoops = unique(state.unresolvedQuestions, 6)
  const corrections = unique(rows.filter((row) => row.role === 'user' && /^(?:no|that's not|that isn't|i mean|what i meant)\b/i.test(row.content.trim())).map((row) => row.content), 6)
  const subtopics = unique([
    ...state.topicCandidates.slice(0, 8),
    ...state.entities,
  ], 10)
  return {
    schemaVersion: 1,
    workingTopic: state.topic,
    subtopics,
    userGoals,
    decisions,
    commitments,
    openLoops,
    activeThreads: state.threads.filter((thread) => thread.status === 'active' || thread.status === 'paused').slice(-6).map((thread) => `${thread.title} [${thread.status}]`),
    importantEntities: unique(state.entities, 12),
    recentCorrections: corrections,
    durableMemoryKeys: memories.slice(0, 8).map((memory) => memory.key),
  }
}

export function buildCanonicalConversationContext(input: {
  currentMessage: string
  rows: readonly PersistedConversationRow[]
  state: CeoConversationState
  references: readonly ConversationReference[]
  memories?: readonly PersistedMemoryRow[]
}): CanonicalConversationContext {
  const currentMessage = normalize(input.currentMessage)
  return {
    schemaVersion: 1,
    currentMessage,
    intentHint: userIntentHint(currentMessage),
    speechAct: speechAct(currentMessage),
    cognitiveDepth: classifyCognitiveDepth(currentMessage, input.state, input.references.length),
    referenceScope: referenceScope(input.references, currentMessage),
    references: input.references,
    worldModel: buildWorldModel(input.state, input.memories ?? [], input.rows),
    state: input.state,
  }
}

export function renderCanonicalConversationContext(context: CanonicalConversationContext): string {
  const refs = context.references.length
    ? context.references.map((reference) => `- ${reference.phrase} → ${reference.resolvedText ?? 'unresolved'} (${Math.round(reference.confidence * 100)}%, ${reference.ambiguous ? 'ambiguous' : 'resolved'})`).join('\n')
    : '- none'
  const world = context.worldModel
  const decisionContract = buildConversationDecisionContract(context)
  return [
    'CANONICAL CEO COGNITIVE CONTEXT (authoritative semantic interpretation; context only, not external evidence):',
    `Current message: ${context.currentMessage}`,
    `Intent hint: ${context.intentHint}`,
    `Speech act: ${context.speechAct}`,
    `Cognitive depth: ${context.cognitiveDepth}`,
    `Reference scope: ${context.referenceScope}`,
    'Resolved references:', refs,
    `Working topic: ${world.workingTopic || 'unknown'}`,
    `Subtopics: ${world.subtopics.join(', ') || 'none'}`,
    `User goals: ${world.userGoals.join(' | ') || 'none'}`,
    `Prior decisions: ${world.decisions.join(' | ') || 'none'}`,
    `Commitments: ${world.commitments.join(' | ') || 'none'}`,
    `Open loops: ${world.openLoops.join(' | ') || 'none'}`,
    `Active threads: ${world.activeThreads.join(' | ') || 'none'}`,
    `Important entities: ${world.importantEntities.join(', ') || 'none'}`,
    `Recent corrections: ${world.recentCorrections.join(' | ') || 'none'}`,
    `Durable memory keys: ${world.durableMemoryKeys.join(', ') || 'none'}`,
    renderConversationDecisionContract(decisionContract),
    'Authority rule: downstream CEO reasoning, response quality, and routing should consume this semantic interpretation rather than independently reinterpreting the current user message.',
  ].join('\n')
}
