import { db } from './db'
import type { FinalResponseProvenance } from './ceo-cognitive-contract'

export interface CeoAssistantPersistenceInput {
  conversationId: string
  content: string
  provenance?: FinalResponseProvenance
}

function lineageMetadata(input: CeoAssistantPersistenceInput): string {
  return JSON.stringify({
    messageContentHash: input.provenance?.finalResponseHash,
    finalResponseHash: input.provenance?.finalResponseHash,
    finalizationId: input.provenance?.finalizationId,
    candidateId: input.provenance?.candidateId,
    candidateHash: input.provenance?.candidateHash,
    qualityDecisionId: input.provenance?.qualityDecisionId,
    contentLength: input.content.length,
  })
}

export async function persistCeoAssistantMessage(input: CeoAssistantPersistenceInput): Promise<string> {
  const content = input.content.trim()
  if (!content) throw new Error('CEO_RESPONSE_PERSISTENCE_EMPTY_CONTENT')
  const message = await db.$transaction(async (tx) => {
    const created = await tx.message.create({ data: { conversationId: input.conversationId, role: 'assistant', content } })
    if (input.provenance) {
      await tx.auditLog.create({ data: { action: 'ceo_response_finalized', entity: 'Message', entityId: created.id, description: 'Canonical CEO response identity persisted atomically with assistant message.', metadata: lineageMetadata(input) } })
    }
    return created
  })
  return message.id
}

export async function updateCeoAssistantMessage(input: { messageId: string; content: string; provenance?: FinalResponseProvenance }): Promise<void> {
  const content = input.content.trim()
  if (!content) throw new Error('CEO_RESPONSE_PERSISTENCE_EMPTY_CONTENT')
  await db.$transaction(async (tx) => {
    const existing = await tx.message.findUnique({ where: { id: input.messageId }, select: { role: true } })
    if (!existing || existing.role !== 'assistant') throw new Error('CEO_RESPONSE_PERSISTENCE_ROLE_MISMATCH')
    await tx.message.update({ where: { id: input.messageId }, data: { content } })
    if (input.provenance) await tx.auditLog.create({ data: { action: 'ceo_response_finalized', entity: 'Message', entityId: input.messageId, description: 'Canonical CEO response identity persisted atomically with assistant message update.', metadata: lineageMetadata(input) } })
  })
}
