import { createHash } from 'node:crypto'
import { db } from './db'

export type ExecutionReceiptInput = {
  missionId: string
  actorId: string
  actorType: string
  action: string
  status: string
  idempotencyKey: string
  requestHash?: string
  inputReference?: string
  outputReference?: string
  errorCode?: string
  startedAt?: Date
  completedAt?: Date
  metadata?: Record<string, unknown>
  userId?: string
}

export type EvidenceSourceInput = {
  provider: string
  sourceUrl: string
  retrievedAt?: Date
  rawEvidenceRef: string
  rawEvidence: unknown
  requestHash?: string
}

export type EvidenceClaimInput = {
  claimKey: string
  claimText: string
  classification: 'FACT' | 'HYPOTHESIS' | 'INFERENCE' | 'CONTRADICTED'
  confidence: number
  verificationStatus: 'UNVERIFIED' | 'VERIFIED' | 'REJECTED' | 'PARTIAL'
  sourceIndex?: number
  notes?: string
}

export type EvidenceLedgerInput = {
  missionId: string
  title: string
  idempotencyKey: string
  status?: 'draft' | 'verified' | 'rejected' | 'superseded'
  userId?: string
  previousHash?: string
  sources: EvidenceSourceInput[]
  claims: EvidenceClaimInput[]
}

export type EvidenceLedgerVerification = {
  valid: boolean
  ledgerId: string
  missionId: string
  version: number
  expectedHash: string
  actualHash: string
  sourceCount: number
  claimCount: number
  errors: string[]
}

function assertNonEmpty(name: string, value: string): void {
  if (!value.trim()) throw new Error(`${name} must not be empty`)
}

function assertConfidence(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error('confidence must be a finite number between 0 and 1')
  }
}

/** Deterministic JSON serialization used by every proof hash. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (value instanceof Date) return JSON.stringify(value.toISOString())
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`
}

export function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')
}

function executionReceiptHash(input: {
  missionId: string
  actorId: string
  actorType: string
  action: string
  status: string
  idempotencyKey: string
  requestHash?: string
  inputReference?: string
  outputReference?: string
  errorCode?: string
  startedAt: Date
  completedAt?: Date
  metadata?: Record<string, unknown>
}): string {
  return sha256({
    missionId: input.missionId,
    actorId: input.actorId,
    actorType: input.actorType,
    action: input.action,
    status: input.status,
    idempotencyKey: input.idempotencyKey,
    requestHash: input.requestHash ?? null,
    inputReference: input.inputReference ?? null,
    outputReference: input.outputReference ?? null,
    errorCode: input.errorCode ?? null,
    startedAt: input.startedAt,
    completedAt: input.completedAt ?? null,
    metadata: input.metadata ?? null,
  })
}

/**
 * Creates an append-only execution receipt. Repeating the same idempotency key
 * returns the original receipt instead of creating a duplicate.
 */
export async function recordExecutionReceipt(input: ExecutionReceiptInput) {
  assertNonEmpty('missionId', input.missionId)
  assertNonEmpty('actorId', input.actorId)
  assertNonEmpty('actorType', input.actorType)
  assertNonEmpty('action', input.action)
  assertNonEmpty('status', input.status)
  assertNonEmpty('idempotencyKey', input.idempotencyKey)

  const existing = await db.executionReceipt.findUnique({
    where: { missionId_idempotencyKey: { missionId: input.missionId, idempotencyKey: input.idempotencyKey } },
  })
  if (existing) return { receipt: existing, created: false }

  const startedAt = input.startedAt ?? new Date()
  const recordHash = executionReceiptHash({ ...input, startedAt })
  const data = {
    missionId: input.missionId,
    userId: input.userId,
    actorId: input.actorId,
    actorType: input.actorType,
    action: input.action,
    status: input.status,
    idempotencyKey: input.idempotencyKey,
    requestHash: input.requestHash,
    inputReference: input.inputReference,
    outputReference: input.outputReference,
    errorCode: input.errorCode,
    startedAt,
    completedAt: input.completedAt,
    recordHash,
    metadata: input.metadata ? canonicalJson(input.metadata) : undefined,
  }

  try {
    const receipt = await db.executionReceipt.create({ data })
    return { receipt, created: true }
  } catch (error) {
    // A concurrent caller may win the unique idempotency race. Re-read and
    // return the canonical receipt instead of exposing a duplicate error.
    const concurrent = await db.executionReceipt.findUnique({
      where: { missionId_idempotencyKey: { missionId: input.missionId, idempotencyKey: input.idempotencyKey } },
    })
    if (concurrent) return { receipt: concurrent, created: false }
    throw error
  }
}

function ledgerContentHash(input: {
  missionId: string
  version: number
  title: string
  status: string
  previousHash?: string
  sources: Array<{
    provider: string
    sourceUrl: string
    retrievedAt: Date
    rawEvidenceRef: string
    rawEvidenceHash: string
    requestHash?: string
  }>
  claims: Array<{
    claimKey: string
    claimText: string
    classification: string
    confidence: number
    verificationStatus: string
    sourceIndex?: number
    sourceId?: string
    notes?: string
  }>
}): string {
  return sha256({
    missionId: input.missionId,
    version: input.version,
    title: input.title,
    status: input.status,
    previousHash: input.previousHash ?? null,
    sources: input.sources.map((source) => ({
      provider: source.provider,
      sourceUrl: source.sourceUrl,
      retrievedAt: source.retrievedAt,
      rawEvidenceRef: source.rawEvidenceRef,
      rawEvidenceHash: source.rawEvidenceHash,
      requestHash: source.requestHash ?? null,
    })),
    claims: input.claims.map((claim) => ({
      claimKey: claim.claimKey,
      claimText: claim.claimText,
      classification: claim.classification,
      confidence: claim.confidence,
      verificationStatus: claim.verificationStatus,
      sourceIndex: claim.sourceIndex ?? null,
      sourceId: claim.sourceId ?? null,
      notes: claim.notes ?? null,
    })),
  })
}

/**
 * Persists an immutable evidence-ledger version and its provenance records in
 * one transaction. The caller must supply the actual raw provider response;
 * only its SHA-256 digest is persisted, keeping potentially sensitive payloads
 * out of the ledger while retaining verifiable provenance.
 */
export async function persistEvidenceLedger(input: EvidenceLedgerInput) {
  assertNonEmpty('missionId', input.missionId)
  assertNonEmpty('title', input.title)
  assertNonEmpty('idempotencyKey', input.idempotencyKey)
  if (!Array.isArray(input.sources)) throw new Error('sources must be an array')
  if (!Array.isArray(input.claims)) throw new Error('claims must be an array')

  for (const source of input.sources) {
    assertNonEmpty('source.provider', source.provider)
    assertNonEmpty('source.sourceUrl', source.sourceUrl)
    assertNonEmpty('source.rawEvidenceRef', source.rawEvidenceRef)
  }
  for (const claim of input.claims) {
    assertNonEmpty('claim.claimKey', claim.claimKey)
    assertNonEmpty('claim.claimText', claim.claimText)
    assertConfidence(claim.confidence)
  }

  const existing = await db.evidenceLedger.findUnique({
    where: { missionId_idempotencyKey: { missionId: input.missionId, idempotencyKey: input.idempotencyKey } },
    include: { Source: true, Claim: true },
  })
  if (existing) return { ledger: existing, created: false }

  const latest = await db.evidenceLedger.findFirst({
    where: { missionId: input.missionId },
    orderBy: { version: 'desc' },
  })
  const version = (latest?.version ?? 0) + 1
  const previousHash = input.previousHash ?? latest?.contentHash

  const preparedSources = input.sources.map((source) => ({
    ...source,
    retrievedAt: source.retrievedAt ?? new Date(),
    rawEvidenceHash: sha256(source.rawEvidence),
  }))

  const contentHash = ledgerContentHash({
    missionId: input.missionId,
    version,
    title: input.title,
    status: input.status ?? 'draft',
    previousHash,
    sources: preparedSources,
    claims: input.claims,
  })

  try {
    const ledger = await db.$transaction(async (tx) => {
      const created = await tx.evidenceLedger.create({
        data: {
          missionId: input.missionId,
          userId: input.userId,
          idempotencyKey: input.idempotencyKey,
          version,
          title: input.title,
          status: input.status ?? 'draft',
          previousHash,
          contentHash,
        },
      })

      const createdSources = []
      for (const source of preparedSources) {
        createdSources.push(await tx.evidenceSource.create({
          data: {
            ledgerId: created.id,
            provider: source.provider,
            sourceUrl: source.sourceUrl,
            retrievedAt: source.retrievedAt,
            rawEvidenceRef: source.rawEvidenceRef,
            rawEvidenceHash: source.rawEvidenceHash,
            requestHash: source.requestHash,
          },
        }))
      }

      for (const claim of input.claims) {
        const sourceId = claim.sourceIndex === undefined ? undefined : createdSources[claim.sourceIndex]?.id
        if (claim.sourceIndex !== undefined && !sourceId) throw new Error(`Claim ${claim.claimKey} references missing source index ${claim.sourceIndex}`)
        await tx.evidenceClaim.create({
          data: {
            ledgerId: created.id,
            sourceId,
            claimKey: claim.claimKey,
            claimText: claim.claimText,
            classification: claim.classification,
            confidence: claim.confidence,
            verificationStatus: claim.verificationStatus,
            notes: claim.notes,
          },
        })
      }

      return tx.evidenceLedger.findUniqueOrThrow({
        where: { id: created.id },
        include: { Source: true, Claim: true },
      })
    })
    return { ledger, created: true }
  } catch (error) {
    const concurrent = await db.evidenceLedger.findUnique({
      where: { missionId_idempotencyKey: { missionId: input.missionId, idempotencyKey: input.idempotencyKey } },
      include: { Source: true, Claim: true },
    })
    if (concurrent) return { ledger: concurrent, created: false }
    throw error
  }
}

export async function verifyEvidenceLedger(ledgerId: string): Promise<EvidenceLedgerVerification> {
  assertNonEmpty('ledgerId', ledgerId)
  const ledger = await db.evidenceLedger.findUnique({
    where: { id: ledgerId },
    include: { Source: true, Claim: true },
  })
  if (!ledger) throw new Error(`Evidence ledger ${ledgerId} was not found`)

  const errors: string[] = []
  const sourceIndexById = new Map(ledger.Source.map((source, index) => [source.id, index]))
  const expectedHash = ledger.contentHash
  const actualHash = ledgerContentHash({
    missionId: ledger.missionId,
    version: ledger.version,
    title: ledger.title,
    status: ledger.status,
    previousHash: ledger.previousHash ?? undefined,
    sources: ledger.Source.map((source) => ({
      provider: source.provider,
      sourceUrl: source.sourceUrl,
      retrievedAt: source.retrievedAt,
      rawEvidenceRef: source.rawEvidenceRef,
      rawEvidenceHash: source.rawEvidenceHash,
      requestHash: source.requestHash ?? undefined,
    })),
    claims: ledger.Claim.map((claim) => ({
      claimKey: claim.claimKey,
      claimText: claim.claimText,
      classification: claim.classification,
      confidence: claim.confidence,
      verificationStatus: claim.verificationStatus,
      sourceIndex: claim.sourceId ? sourceIndexById.get(claim.sourceId) : undefined,
      sourceId: claim.sourceId ?? undefined,
      notes: claim.notes ?? undefined,
    })),
  })

  if (expectedHash !== actualHash) errors.push('Ledger content hash mismatch')
  if (new Set(ledger.Claim.map((claim) => claim.claimKey)).size !== ledger.Claim.length) errors.push('Duplicate claim keys detected')
  if (new Set(ledger.Source.map((source) => `${source.sourceUrl}\n${source.rawEvidenceHash}`)).size !== ledger.Source.length) errors.push('Duplicate source provenance detected')
  for (const source of ledger.Source) {
    if (!source.provider || !source.sourceUrl || !source.rawEvidenceRef || !source.rawEvidenceHash) errors.push(`Incomplete source provenance: ${source.id}`)
  }
  for (const claim of ledger.Claim) {
    if (claim.sourceId && !sourceIndexById.has(claim.sourceId)) errors.push(`Claim ${claim.claimKey} references a missing source`)
    if (!Number.isFinite(claim.confidence) || claim.confidence < 0 || claim.confidence > 1) errors.push(`Claim ${claim.claimKey} has invalid confidence`)
  }

  return {
    valid: errors.length === 0,
    ledgerId: ledger.id,
    missionId: ledger.missionId,
    version: ledger.version,
    expectedHash,
    actualHash,
    sourceCount: ledger.Source.length,
    claimCount: ledger.Claim.length,
    errors,
  }
}
