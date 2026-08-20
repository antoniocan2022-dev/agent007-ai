import { db } from './db'
import { recordExecutionReceipt, sha256 } from './proof-ledger'

export type ExecutionScope = 'mission' | 'unscoped'
export type ExecutionStatus = 'STARTED' | 'SUCCESS' | 'FAILED' | 'DENIED'

export interface ExecutionProof {
  receiptId: string
  missionId: string
  scope: ExecutionScope
  status: ExecutionStatus
  requestHash: string
  outputReference?: string
}

function requireText(name: string, value: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${name} must not be empty`)
  return normalized
}

export function resolveExecutionScope(input: {
  missionId?: string
  conversationId?: string
  requestHash: string
}): { missionId: string; scope: ExecutionScope } {
  const missionId = input.missionId?.trim()
  if (missionId) return { missionId, scope: 'mission' }

  const anchor = input.conversationId?.trim() || input.requestHash.slice(0, 32)
  return { missionId: `unscoped:${anchor}`, scope: 'unscoped' }
}

export async function startMandatoryExecution(input: {
  missionId?: string
  conversationId?: string
  actorId: string
  actorType: string
  action: string
  idempotencyKey: string
  args: unknown
}) {
  const requestHash = sha256(input.args ?? {})
  const scope = resolveExecutionScope({
    missionId: input.missionId,
    conversationId: input.conversationId,
    requestHash,
  })
  const receipt = await recordExecutionReceipt({
    missionId: scope.missionId,
    actorId: requireText('actorId', input.actorId),
    actorType: requireText('actorType', input.actorType),
    action: requireText('action', input.action),
    status: 'STARTED',
    idempotencyKey: requireText('idempotencyKey', input.idempotencyKey),
    requestHash,
    inputReference: `tool-input-sha256:${requestHash}`,
    startedAt: new Date(),
    metadata: { executionScope: scope.scope },
  })

  return {
    receipt: receipt.receipt,
    scope,
    requestHash,
  }
}

export async function completeMandatoryExecution(input: {
  receiptId: string
  missionId: string
  status: Exclude<ExecutionStatus, 'STARTED'>
  requestHash: string
  output?: unknown
  errorCode?: string
  metadata?: Record<string, unknown>
}) {
  const outputReference = input.output === undefined
    ? undefined
    : `tool-output-sha256:${sha256(input.output)}`

  const recordHash = sha256({
    missionId: input.missionId,
    receiptId: input.receiptId,
    status: input.status,
    requestHash: input.requestHash,
    outputReference: outputReference ?? null,
    errorCode: input.errorCode ?? null,
    metadata: input.metadata ?? null,
  })

  const receipt = await db.executionReceipt.update({
    where: { id: input.receiptId },
    data: {
      status: input.status,
      completedAt: new Date(),
      outputReference,
      errorCode: input.errorCode,
      recordHash,
      metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
    },
  })

  return { receipt, outputReference }
}

export function executionProofText(proof: ExecutionProof): string {
  return `Execution proof: receipt=${proof.receiptId}; scope=${proof.scope}; status=${proof.status}; request=${proof.requestHash}.`
}

export function requireExecutionProof(proof: ExecutionProof | null | undefined): ExecutionProof {
  if (!proof?.receiptId) throw new Error('EXECUTION_CONTRACT_VIOLATION: execution receipt is required before claiming an action occurred.')
  if (!proof.missionId.trim()) throw new Error('EXECUTION_CONTRACT_VIOLATION: execution scope is missing.')
  return proof
}
