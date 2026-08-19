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
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('confidence must be a finite number between 0 and 1')
}

export function canonicalJson(value: unknown): string {
  if (value === undefined || value === null || typeof value !== 'object') return JSON.stringify(value)
  if (value instanceof Date) return JSON.stringify(value.toISOString())
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`
}

export function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')
}

function parseMetadata(value: string | null): Record<string, unknown> | null {
  if (!value) return null
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function executionReceiptFingerprint(input: {
  missionId: string
  actorId: string
  actorType: string
  action: string
  status: string
  idempotencyKey: string
  requestHash?: string | null
  inputReference?: string | null
  outputReference?: string | null
  errorCode?: string | null
  metadata?: Record<string, unknown> | null
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
    metadata: input.metadata ?? null,
  })
}

function assertReceiptCompatible(existing: {
  missionId: string
  actorId: string
  actorType: string
  action: string
  status: string
  idempotencyKey: string
  requestHash: string | null
  inputReference: string | null
  outputReference: string | null
  errorCode: string | null
  metadata: string | null
}, input: ExecutionReceiptInput): void {
  const expected = executionReceiptFingerprint({
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
    metadata: input.metadata ?? null,
  })
  const actual = executionReceiptFingerprint({
    missionId: existing.missionId,
    actorId: existing.actorId,
    actorType: existing.actorType,
    action: existing.action,
    status: existing.status,
    idempotencyKey: existing.idempotencyKey,
    requestHash: existing.requestHash,
    inputReference: existing.inputReference,
    outputReference: existing.outputReference,
    errorCode: existing.errorCode,
    metadata: parseMetadata(existing.metadata),
  })
  if (expected !== actual) throw new Error(`Execution receipt idempotency conflict for ${input.missionId}:${input.idempotencyKey}.`)
}

export async function recordExecutionReceipt(input: ExecutionReceiptInput) {
  for (const [name, value] of Object.entries({ missionId: input.missionId, actorId: input.actorId, actorType: input.actorType, action: input.action, status: input.status, idempotencyKey: input.idempotencyKey })) assertNonEmpty(name, value)

  const existing = await db.executionReceipt.findUnique({ where: { missionId_idempotencyKey: { missionId: input.missionId, idempotencyKey: input.idempotencyKey } } })
  if (existing) {
    assertReceiptCompatible(existing, input)
    return { receipt: existing, created: false }
  }

  const startedAt = input.startedAt ?? new Date()
  const recordHash = executionReceiptFingerprint({ ...input, metadata: input.metadata ?? null })
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
    const concurrent = await db.executionReceipt.findUnique({ where: { missionId_idempotencyKey: { missionId: input.missionId, idempotencyKey: input.idempotencyKey } } })
    if (!concurrent) throw error
    assertReceiptCompatible(concurrent, input)
    return { receipt: concurrent, created: false }
  }
}

type PreparedSource = EvidenceSourceInput & { retrievedAt: Date; rawEvidenceHash: string }
type HashSource = Omit<PreparedSource, 'rawEvidence'>
type HashClaim = Omit<EvidenceClaimInput, 'sourceIndex'> & { sourceKey: string | null }

function sourceKey(source: Pick<PreparedSource, 'provider' | 'sourceUrl' | 'rawEvidenceRef' | 'rawEvidenceHash' | 'requestHash'>): string {
  return sha256({ provider: source.provider, sourceUrl: source.sourceUrl, rawEvidenceRef: source.rawEvidenceRef, rawEvidenceHash: source.rawEvidenceHash, requestHash: source.requestHash ?? null })
}

function ledgerContentHash(input: {
  missionId: string
  version: number
  title: string
  status: string
  previousHash?: string | null
  sources: HashSource[]
  claims: HashClaim[]
}): string {
  const sources = [...input.sources].sort((a, b) => sourceKey(a).localeCompare(sourceKey(b))).map((source) => ({
    key: sourceKey(source), provider: source.provider, sourceUrl: source.sourceUrl, retrievedAt: source.retrievedAt,
    rawEvidenceRef: source.rawEvidenceRef, rawEvidenceHash: source.rawEvidenceHash, requestHash: source.requestHash ?? null,
  }))
  const claims = [...input.claims].sort((a, b) => a.claimKey.localeCompare(b.claimKey)).map((claim) => ({
    claimKey: claim.claimKey, claimText: claim.claimText, classification: claim.classification, confidence: claim.confidence,
    verificationStatus: claim.verificationStatus, sourceKey: claim.sourceKey, notes: claim.notes ?? null,
  }))
  return sha256({ missionId: input.missionId, version: input.version, title: input.title, status: input.status, previousHash: input.previousHash ?? null, sources, claims })
}

function validateLedgerInput(input: EvidenceLedgerInput): void {
  assertNonEmpty('missionId', input.missionId)
  assertNonEmpty('title', input.title)
  assertNonEmpty('idempotencyKey', input.idempotencyKey)
  if (!Array.isArray(input.sources) || !Array.isArray(input.claims)) throw new Error('sources and claims must be arrays')
  const sourceFingerprints = new Set<string>()
  input.sources.forEach((source, index) => {
    assertNonEmpty(`source[${index}].provider`, source.provider)
    assertNonEmpty(`source[${index}].sourceUrl`, source.sourceUrl)
    assertNonEmpty(`source[${index}].rawEvidenceRef`, source.rawEvidenceRef)
    if (source.retrievedAt && !Number.isFinite(source.retrievedAt.getTime())) throw new Error(`source[${index}].retrievedAt must be a valid date`)
    const fp = sha256({ provider: source.provider, sourceUrl: source.sourceUrl, rawEvidenceRef: source.rawEvidenceRef, rawEvidenceHash: sha256(source.rawEvidence), requestHash: source.requestHash ?? null })
    if (!sourceFingerprints.add(fp)) throw new Error(`Duplicate evidence source provenance at index ${index}.`)
  })
  const claimKeys = new Set<string>()
  input.claims.forEach((claim, index) => {
    assertNonEmpty(`claim[${index}].claimKey`, claim.claimKey)
    assertNonEmpty(`claim[${index}].claimText`, claim.claimText)
    assertConfidence(claim.confidence)
    if (claim.sourceIndex !== undefined && (!Number.isInteger(claim.sourceIndex) || claim.sourceIndex < 0 || claim.sourceIndex >= input.sources.length)) throw new Error(`Claim ${claim.claimKey} references invalid source index ${claim.sourceIndex}.`)
    if (!claimKeys.add(claim.claimKey)) throw new Error(`Duplicate evidence claim key: ${claim.claimKey}.`)
  })
}

function prepareSources(input: EvidenceSourceInput[]): PreparedSource[] {
  return input.map((source) => ({ ...source, retrievedAt: source.retrievedAt ?? new Date(), rawEvidenceHash: sha256(source.rawEvidence) }))
}

function ledgerInputFingerprint(input: EvidenceLedgerInput, preparedSources: PreparedSource[], status: string): string {
  return sha256({
    missionId: input.missionId, title: input.title, status, previousHash: input.previousHash ?? null,
    sources: preparedSources.map((source) => ({ key: sourceKey(source), provider: source.provider, sourceUrl: source.sourceUrl, rawEvidenceRef: source.rawEvidenceRef, rawEvidenceHash: source.rawEvidenceHash, requestHash: source.requestHash ?? null })),
    claims: input.claims.map((claim) => ({ claimKey: claim.claimKey, claimText: claim.claimText, classification: claim.classification, confidence: claim.confidence, verificationStatus: claim.verificationStatus, sourceIndex: claim.sourceIndex ?? null, notes: claim.notes ?? null })),
  })
}

function assertLedgerCompatible(existing: { missionId: string; title: string; status: string; previousHash: string | null; Source: Array<{ provider: string; sourceUrl: string; rawEvidenceRef: string; rawEvidenceHash: string; requestHash: string | null }>; Claim: Array<{ claimKey: string; claimText: string; classification: string; confidence: number; verificationStatus: string; notes: string | null; sourceId: string | null }> }, input: EvidenceLedgerInput): void {
  const prepared = prepareSources(input.sources)
  const sourceIdByKey = new Map(existing.Source.map((source) => [sourceKey(source), source.id]))
  const expected = ledgerInputFingerprint(input, prepared, input.status ?? existing.status)
  const actual = sha256({
    missionId: existing.missionId, title: existing.title, status: existing.status, previousHash: existing.previousHash,
    sources: existing.Source.map((source) => ({ key: sourceKey(source), provider: source.provider, sourceUrl: source.sourceUrl, rawEvidenceRef: source.rawEvidenceRef, rawEvidenceHash: source.rawEvidenceHash, requestHash: source.requestHash ?? null })),
    claims: existing.Claim.map((claim) => ({ claimKey: claim.claimKey, claimText: claim.claimText, classification: claim.classification, confidence: claim.confidence, verificationStatus: claim.verificationStatus, sourceIndex: claim.sourceId ? sourceIdByKey.get(sourceKey(existing.Source.find((source) => source.id === claim.sourceId)!)) : null, notes: claim.notes ?? null })),
  })
  if (expected !== actual) throw new Error(`Evidence ledger idempotency conflict for ${input.missionId}:${input.idempotencyKey}.`)
}

export async function persistEvidenceLedger(input: EvidenceLedgerInput) {
  validateLedgerInput(input)
  const status = input.status ?? 'draft'
  const existing = await db.evidenceLedger.findUnique({ where: { missionId_idempotencyKey: { missionId: input.missionId, idempotencyKey: input.idempotencyKey } }, include: { Source: true, Claim: true } })
  if (existing) {
    assertLedgerCompatible(existing, input)
    return { ledger: existing, created: false }
  }

  const latest = await db.evidenceLedger.findFirst({ where: { missionId: input.missionId }, orderBy: { version: 'desc' } })
  if (input.previousHash !== undefined && input.previousHash !== (latest?.contentHash ?? null)) throw new Error('previousHash does not match the latest ledger version.')
  const version = (latest?.version ?? 0) + 1
  const previousHash = latest?.contentHash ?? input.previousHash ?? null
  const preparedSources = prepareSources(input.sources)
  const preparedHashSources = preparedSources.map(({ rawEvidence, ...source }) => source)
  const preparedClaims: HashClaim[] = input.claims.map((claim) => ({ ...claim, sourceKey: claim.sourceIndex === undefined ? null : sourceKey(preparedSources[claim.sourceIndex]) }))
  const contentHash = ledgerContentHash({ missionId: input.missionId, version, title: input.title, status, previousHash, sources: preparedHashSources, claims: preparedClaims })

  try {
    const ledger = await db.$transaction(async (tx) => {
      const created = await tx.evidenceLedger.create({ data: { missionId: input.missionId, userId: input.userId, idempotencyKey: input.idempotencyKey, version, title: input.title, status, previousHash, contentHash } })
      const createdSources = []
      for (const source of preparedSources) createdSources.push(await tx.evidenceSource.create({ data: { ledgerId: created.id, provider: source.provider, sourceUrl: source.sourceUrl, retrievedAt: source.retrievedAt, rawEvidenceRef: source.rawEvidenceRef, rawEvidenceHash: source.rawEvidenceHash, requestHash: source.requestHash } }))
      const idByIndex = createdSources.map((source) => source.id)
      for (const claim of input.claims) await tx.evidenceClaim.create({ data: { ledgerId: created.id, sourceId: claim.sourceIndex === undefined ? undefined : idByIndex[claim.sourceIndex], claimKey: claim.claimKey, claimText: claim.claimText, classification: claim.classification, confidence: claim.confidence, verificationStatus: claim.verificationStatus, notes: claim.notes } })
      return tx.evidenceLedger.findUniqueOrThrow({ where: { id: created.id }, include: { Source: true, Claim: true } })
    })
    return { ledger, created: true }
  } catch (error) {
    const concurrent = await db.evidenceLedger.findUnique({ where: { missionId_idempotencyKey: { missionId: input.missionId, idempotencyKey: input.idempotencyKey } }, include: { Source: true, Claim: true } })
    if (concurrent) { assertLedgerCompatible(concurrent, input); return { ledger: concurrent, created: false } }
    throw error
  }
}

export async function verifyEvidenceLedger(ledgerId: string): Promise<EvidenceLedgerVerification> {
  assertNonEmpty('ledgerId', ledgerId)
  const ledger = await db.evidenceLedger.findUnique({ where: { id: ledgerId }, include: { Source: true, Claim: true } })
  if (!ledger) throw new Error(`Evidence ledger ${ledgerId} was not found`)

  const errors: string[] = []
  const sourceById = new Map(ledger.Source.map((source) => [source.id, source]))
  const hashSources = ledger.Source.map(({ id: _id, ...source }) => source)
  const hashClaims: HashClaim[] = ledger.Claim.map((claim) => {
    const source = claim.sourceId ? sourceById.get(claim.sourceId) : null
    return { claimKey: claim.claimKey, claimText: claim.claimText, classification: claim.classification as HashClaim['classification'], confidence: claim.confidence, verificationStatus: claim.verificationStatus as HashClaim['verificationStatus'], sourceKey: source ? sourceKey(source) : null, notes: claim.notes ?? undefined }
  })
  const actualHash = ledgerContentHash({ missionId: ledger.missionId, version: ledger.version, title: ledger.title, status: ledger.status, previousHash: ledger.previousHash, sources: hashSources, claims: hashClaims })
  if (actualHash !== ledger.contentHash) errors.push('Ledger content hash mismatch')

  if (new Set(ledger.Claim.map((claim) => claim.claimKey)).size !== ledger.Claim.length) errors.push('Duplicate claim keys detected')
  if (new Set(ledger.Source.map((source) => sourceKey(source))).size !== ledger.Source.length) errors.push('Duplicate source provenance detected')
  for (const source of ledger.Source) if (!source.provider || !source.sourceUrl || !source.rawEvidenceRef || !source.rawEvidenceHash) errors.push(`Incomplete source provenance: ${source.id}`)
  for (const claim of ledger.Claim) {
    if (claim.sourceId && !sourceById.has(claim.sourceId)) errors.push(`Claim ${claim.claimKey} references a missing source`)
    if (!Number.isFinite(claim.confidence) || claim.confidence < 0 || claim.confidence > 1) errors.push(`Claim ${claim.claimKey} has invalid confidence`)
  }
  if (ledger.previousHash) {
    const previous = await db.evidenceLedger.findFirst({ where: { missionId: ledger.missionId, version: ledger.version - 1 } })
    if (!previous || previous.contentHash !== ledger.previousHash) errors.push('Ledger previousHash chain link is invalid')
  }

  return { valid: errors.length === 0, ledgerId: ledger.id, missionId: ledger.missionId, version: ledger.version, expectedHash: ledger.contentHash, actualHash, sourceCount: ledger.Source.length, claimCount: ledger.Claim.length, errors }
}
