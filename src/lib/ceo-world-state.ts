import type { CeoConversationState } from './ceo-conversation-state'
import type { PersistedConversationRow } from './ceo-context-composer'
import { deriveCeoConversationState } from './ceo-conversation-state'

export type WorldStateRecordKind = 'decision' | 'goal' | 'commitment' | 'openLoop' | 'correction'
export type WorldStateRecordStatus = 'active' | 'resolved' | 'superseded'

export interface WorldStateRecord {
  kind: WorldStateRecordKind
  text: string
  status: WorldStateRecordStatus
  confidence: number
  source: 'user' | 'assistant'
  sourceTurn: number
}

export interface WorldStateSnapshot {
  schemaVersion: 1
  decisions: WorldStateRecord[]
  goals: WorldStateRecord[]
  commitments: WorldStateRecord[]
  openLoops: WorldStateRecord[]
  corrections: WorldStateRecord[]
}

function normalize(value: string): string { return value.replace(/\s+/g, ' ').trim() }

function overlap(a: string, b: string): number {
  const tokensA = new Set(normalize(a).toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4))
  const tokensB = new Set(normalize(b).toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4))
  if (!tokensA.size || !tokensB.size) return 0
  let shared = 0
  for (const token of tokensA) if (tokensB.has(token)) shared += 1
  return shared / Math.min(tokensA.size, tokensB.size)
}

// A record is superseded when a later correction in the same conversation overlaps substantially
// with its text -- the user explicitly walked it back, not merely mentioned something related.
function statusFor(text: string, sourceTurn: number, corrections: readonly { text: string; sourceTurn: number }[]): WorldStateRecordStatus {
  const supersededBy = corrections.find((correction) => correction.sourceTurn > sourceTurn && overlap(text, correction.text) >= 0.4)
  return supersededBy ? 'superseded' : 'active'
}

function extractRecords(kind: WorldStateRecordKind, items: readonly string[], rows: readonly PersistedConversationRow[], corrections: readonly { text: string; sourceTurn: number }[]): WorldStateRecord[] {
  return items.map((text) => {
    const sourceTurn = rows.findIndex((row) => normalize(row.content) === normalize(text) || normalize(row.content).includes(normalize(text).slice(0, 40)))
    const resolvedTurn = sourceTurn >= 0 ? sourceTurn : rows.length - 1
    const source: 'user' | 'assistant' = sourceTurn >= 0 && rows[sourceTurn]?.role === 'assistant' ? 'assistant' : 'user'
    // Confidence reflects how directly this record's text was actually found in a real row (a
    // resolved source turn) versus reconstructed indirectly -- not a claim about factual truth.
    const confidence = sourceTurn >= 0 ? 0.85 : 0.6
    return { kind, text, status: kind === 'correction' ? 'active' : statusFor(text, resolvedTurn, corrections), confidence, source, sourceTurn: resolvedTurn }
  })
}

export function buildWorldStateSnapshot(state: CeoConversationState, rows: readonly PersistedConversationRow[]): WorldStateSnapshot {
  const correctionRows = rows.map((row, index) => ({ row, index })).filter(({ row }) => row.role === 'user' && /^(?:no|that's not|that isn't|i mean|what i meant|correction)\b/i.test(row.content.trim()))
  const corrections = correctionRows.map(({ row, index }) => ({ text: normalize(row.content), sourceTurn: index }))
  return {
    schemaVersion: 1,
    decisions: extractRecords('decision', state.decisions, rows, corrections),
    goals: extractRecords('goal', state.recentUserGoals, rows, corrections),
    commitments: extractRecords('commitment', rows.filter((row) => row.role === 'user' && /\b(?:i will|we will|let's|lets|we're going to|i'm going to)\b/i.test(row.content)).map((row) => normalize(row.content)).slice(-6), rows, corrections),
    openLoops: extractRecords('openLoop', state.unresolvedQuestions, rows, corrections),
    corrections: extractRecords('correction', corrections.map((c) => c.text), rows, corrections),
  }
}

export interface WorldStateDelta {
  schemaVersion: 1
  newDecisions: WorldStateRecord[]
  newGoals: WorldStateRecord[]
  newCommitments: WorldStateRecord[]
  newOpenLoops: WorldStateRecord[]
  resolvedOpenLoops: string[]
  newCorrections: WorldStateRecord[]
  newlySuperseded: WorldStateRecord[]
}

function diffByText(before: readonly WorldStateRecord[], after: readonly WorldStateRecord[]): WorldStateRecord[] {
  const beforeTexts = new Set(before.map((record) => record.text))
  return after.filter((record) => !beforeTexts.has(record.text))
}

// Computes what changed this turn by comparing the world state derived from the conversation
// BEFORE this exchange against the state derived from the conversation AFTER it -- using the
// same recomputation the rest of the architecture already relies on, rather than introducing a
// second, incrementally-mutated state store that could drift from the conversation history.
export function computeWorldStateDelta(priorRows: readonly PersistedConversationRow[], currentRows: readonly PersistedConversationRow[], objective: string): WorldStateDelta {
  const beforeState = deriveCeoConversationState(priorRows, objective)
  const afterState = deriveCeoConversationState(currentRows, objective)
  const before = buildWorldStateSnapshot(beforeState, priorRows)
  const after = buildWorldStateSnapshot(afterState, currentRows)
  const beforeOpenLoopTexts = new Set(before.openLoops.map((record) => record.text))
  const afterOpenLoopTexts = new Set(after.openLoops.map((record) => record.text))
  const resolvedOpenLoops = [...beforeOpenLoopTexts].filter((text) => !afterOpenLoopTexts.has(text))
  const beforeActiveByText = new Map(before.decisions.filter((record) => record.status === 'active').map((record) => [record.text, record] as const))
  const newlySuperseded = after.decisions.filter((record) => record.status === 'superseded' && beforeActiveByText.has(record.text))
  return {
    schemaVersion: 1,
    newDecisions: diffByText(before.decisions, after.decisions),
    newGoals: diffByText(before.goals, after.goals),
    newCommitments: diffByText(before.commitments, after.commitments),
    newOpenLoops: diffByText(before.openLoops, after.openLoops),
    resolvedOpenLoops,
    newCorrections: diffByText(before.corrections, after.corrections),
    newlySuperseded,
  }
}
