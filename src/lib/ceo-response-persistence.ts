import { createHash } from 'node:crypto'
import { db } from './db'
import type { FinalResponseProvenance } from './ceo-cognitive-contract'

export interface CeoAssistantPersistenceInput { conversationId: string; content: string; provenance: FinalResponseProvenance }

// Recommendation 2 (optimistic revision-sequencing): thrown when the atomic check inside the same
// transaction as the write finds the conversation's revision has already advanced past the turn this
// response was computed against. Checking and writing in one transaction (rather than a separate read
// followed by a conditional write) closes the race window a newer turn could otherwise land in between
// the two -- the entire "is this still current" decision and the write itself are one atomic step.
export class CeoResponseSupersededError extends Error {
  readonly latestRevision: number
  constructor(latestRevision: number) { super('CEO_RESPONSE_SUPERSEDED'); this.name = 'CeoResponseSupersededError'; this.latestRevision = latestRevision }
}

function contentHash(content: string): string { return createHash('sha256').update(content.trim(), 'utf8').digest('hex') }
function assertPersistenceIdentity(content: string, provenance: FinalResponseProvenance): void {
  const normalized = content.trim()
  const hash = contentHash(normalized)
  if (provenance.finalResponseHash !== hash) throw new Error('CEO_RESPONSE_PERSISTENCE_HASH_MISMATCH')
  if (provenance.finalizationId !== `ceo-final-${hash.slice(0, 16)}`) throw new Error('CEO_RESPONSE_PERSISTENCE_ID_MISMATCH')
  if (provenance.finalContentLength !== normalized.length) throw new Error('CEO_RESPONSE_PERSISTENCE_LENGTH_MISMATCH')
}
function lineageMetadata(input: CeoAssistantPersistenceInput): string {
  assertPersistenceIdentity(input.content, input.provenance)
  return JSON.stringify({ finalResponseHash: input.provenance.finalResponseHash, finalizationId: input.provenance.finalizationId, candidateId: input.provenance.candidateId, candidateHash: input.provenance.candidateHash, qualityDecisionId: input.provenance.qualityDecisionId, contentLength: input.content.trim().length })
}

export async function persistCeoAssistantMessage(input: CeoAssistantPersistenceInput & { capturedTurnSequence: number }): Promise<string> {
  const content = input.content.trim()
  if (!content) throw new Error('CEO_RESPONSE_PERSISTENCE_EMPTY_CONTENT')
  const message = await db.$transaction(async (tx) => {
    const conversation = await tx.conversation.findUnique({ where: { id: input.conversationId }, select: { revision: true } })
    if (conversation && conversation.revision > input.capturedTurnSequence) throw new CeoResponseSupersededError(conversation.revision)
    const created = await tx.message.create({ data: { conversationId: input.conversationId, role: 'assistant', content, turnSequence: input.capturedTurnSequence } })
    await tx.auditLog.create({ data: { action: 'ceo_response_finalized', entity: 'Message', entityId: created.id, description: 'Canonical CEO response identity persisted atomically with assistant message.', metadata: lineageMetadata({ ...input, content }) } })
    return created
  })
  return message.id
}

export async function updateCeoAssistantMessage(input: { messageId: string; content: string; provenance: FinalResponseProvenance; capturedTurnSequence: number; conversationId: string }): Promise<void> {
  const content = input.content.trim()
  if (!content) throw new Error('CEO_RESPONSE_PERSISTENCE_EMPTY_CONTENT')
  await db.$transaction(async (tx) => {
    const conversation = await tx.conversation.findUnique({ where: { id: input.conversationId }, select: { revision: true } })
    if (conversation && conversation.revision > input.capturedTurnSequence) throw new CeoResponseSupersededError(conversation.revision)
    const existing = await tx.message.findUnique({ where: { id: input.messageId }, select: { role: true } })
    if (!existing || existing.role !== 'assistant') throw new Error('CEO_RESPONSE_PERSISTENCE_ROLE_MISMATCH')
    await tx.message.update({ where: { id: input.messageId }, data: { content } })
    await tx.auditLog.create({ data: { action: 'ceo_response_finalized', entity: 'Message', entityId: input.messageId, description: 'Canonical CEO response identity persisted atomically with assistant message update.', metadata: lineageMetadata({ conversationId: input.conversationId, content, provenance: input.provenance }) } })
  })
}

// Recommendation 2 (optimistic revision-sequencing): a response that finished computing after a
// newer user turn was already accepted for the same conversation is stale relative to the "current
// request" the CEO is supposed to be authoritative for. It is never written into the visible
// Message transcript (that would present out-of-order content as the latest reply) -- instead this
// records an audit trail entry so the work is never silently discarded, only never surfaced.
export async function recordSupersededCeoResponse(input: { conversationId: string; content: string; capturedTurnSequence: number; latestRevision: number }): Promise<void> {
  await db.auditLog.create({ data: { action: 'ceo_response_superseded', entity: 'Conversation', entityId: input.conversationId, description: `A CEO response finished computing against turn ${input.capturedTurnSequence} after conversation revision advanced to ${input.latestRevision}; it was not added to the conversation.`, metadata: JSON.stringify({ capturedTurnSequence: input.capturedTurnSequence, latestRevision: input.latestRevision, contentLength: input.content.trim().length, contentHash: contentHash(input.content.trim()) }) } })
}

// Recommendation 3 (narrowed two-state crash marker): a user turn's Message row is created with
// turnStatus='open' and flipped to 'closed' here on every normal exit path this request can take
// (success, degraded, superseded, cancelled, or error -- see route.ts). A turn that is still 'open'
// after its request handler has had a chance to run means the process crashed or was killed before
// reaching any of those exits: durable, queryable evidence of an incomplete turn, deliberately without
// a full persisted lifecycle state machine (open/closed is the entire state space).
export async function closeCeoTurnMarker(input: { conversationId: string; turnSequence: number }): Promise<void> {
  await db.message.updateMany({ where: { conversationId: input.conversationId, turnSequence: input.turnSequence, role: 'user' }, data: { turnStatus: 'closed' } })
}
