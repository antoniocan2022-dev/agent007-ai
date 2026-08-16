import { createHash, randomUUID } from 'node:crypto'
import { db } from '@/lib/db'

export type ArtifactStatus = 'draft' | 'submitted' | 'verified' | 'rejected' | 'handed_off' | 'superseded'

export interface ArtifactHandoff {
  consumerAgentId: string
  handedAt: string
}

export interface RegisterArtifactInput {
  missionId?: string
  ventureId?: string
  parentArtifactId?: string
  stageId?: string
  artifactType: string
  name: string
  producerAgentId: string
  consumerAgentId?: string
  sourceRef?: string
  artifactValue?: string | null
  content?: string
  status?: ArtifactStatus
  verificationScore?: number
  verifiedBy?: string
  verifiedAt?: Date
  metadata?: Record<string, unknown>
}

export interface ArtifactLedgerEntry {
  id: string
  artifactId: string
  missionId: string | null
  ventureId: string | null
  parentArtifactId: string | null
  stageId: string | null
  artifactType: string
  name: string
  version: number
  status: ArtifactStatus
  producerAgentId: string
  consumerAgentId: string | null
  sourceRef: string | null
  artifactValue: string | null
  contentHash: string
  verificationScore: number | null
  verifiedBy: string | null
  verifiedAt: Date | null
  metadata: string | null
  handoffHistory: string | null
  createdAt: Date
  updatedAt: Date
}

export function hashArtifact(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

function clampScore(score: number | undefined): number | undefined {
  if (score === undefined) return undefined
  if (!Number.isFinite(score)) return undefined
  return Math.min(100, Math.max(0, score))
}

function parseHandoffs(value: string | null | undefined): ArtifactHandoff[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (entry): entry is ArtifactHandoff =>
        !!entry && typeof entry.consumerAgentId === 'string' && typeof entry.handedAt === 'string'
    )
  } catch {
    return []
  }
}

function serializeHandoffs(entries: ArtifactHandoff[]): string {
  return JSON.stringify(entries.slice(-50))
}

async function getParentArtifact(parentArtifactId: string) {
  return db.artifactLedger.findUnique({ where: { artifactId: parentArtifactId } })
}

export async function registerArtifact(input: RegisterArtifactInput): Promise<ArtifactLedgerEntry> {
  if (!input.producerAgentId?.trim()) throw new Error('Artifact producerAgentId is required.')
  if (!input.artifactType?.trim()) throw new Error('Artifact artifactType is required.')
  if (!input.name?.trim()) throw new Error('Artifact name is required.')

  const content = input.content ?? input.artifactValue ?? ''
  const contentHash = hashArtifact(content)

  // Idempotency: the same source event cannot create duplicate ledger rows.
  if (input.sourceRef) {
    const existing = await db.artifactLedger.findFirst({
      where: {
        sourceRef: input.sourceRef,
        producerAgentId: input.producerAgentId,
        missionId: input.missionId,
        stageId: input.stageId,
        contentHash,
      },
    })
    if (existing) return existing as ArtifactLedgerEntry
  }

  // Parent lineage must point to an existing artifact in the same mission/venture.
  if (input.parentArtifactId) {
    const parent = await getParentArtifact(input.parentArtifactId)
    if (!parent) throw new Error(`Parent artifact not found: ${input.parentArtifactId}`)
    if (input.missionId && parent.missionId && input.missionId !== parent.missionId) {
      throw new Error(`Parent artifact ${input.parentArtifactId} belongs to a different mission.`)
    }
    if (input.ventureId && parent.ventureId && input.ventureId !== parent.ventureId) {
      throw new Error(`Parent artifact ${input.parentArtifactId} belongs to a different venture.`)
    }
  }

  let version = 1
  if (input.missionId && input.stageId) {
    const latest = await db.artifactLedger.findFirst({
      where: {
        missionId: input.missionId,
        stageId: input.stageId,
        producerAgentId: input.producerAgentId,
      },
      orderBy: { version: 'desc' },
    })
    version = (latest?.version ?? 0) + 1
  }

  const created = await db.artifactLedger.create({
    data: {
      artifactId: `artifact_${randomUUID()}`,
      missionId: input.missionId,
      ventureId: input.ventureId,
      parentArtifactId: input.parentArtifactId,
      stageId: input.stageId,
      artifactType: input.artifactType,
      name: input.name.slice(0, 200),
      version,
      status: input.status ?? 'submitted',
      producerAgentId: input.producerAgentId,
      consumerAgentId: input.consumerAgentId,
      sourceRef: input.sourceRef,
      artifactValue: input.artifactValue?.slice(0, 4000) ?? null,
      contentHash,
      verificationScore: clampScore(input.verificationScore),
      verifiedBy: input.verifiedBy,
      verifiedAt: input.verifiedAt,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      handoffHistory: input.consumerAgentId
        ? serializeHandoffs([{ consumerAgentId: input.consumerAgentId, handedAt: new Date().toISOString() }])
        : null,
    },
  })

  return created as ArtifactLedgerEntry
}

export async function verifyArtifact(
  artifactId: string,
  verificationScore: number,
  verifiedBy: string,
  status: Extract<ArtifactStatus, 'verified' | 'rejected'> = 'verified',
): Promise<ArtifactLedgerEntry> {
  const current = await db.artifactLedger.findUnique({ where: { artifactId } })
  if (!current) throw new Error(`Artifact not found: ${artifactId}`)
  if (current.status === 'superseded') throw new Error(`Superseded artifact cannot be verified: ${artifactId}`)

  const updated = await db.artifactLedger.update({
    where: { artifactId },
    data: {
      verificationScore: clampScore(verificationScore),
      verifiedBy,
      verifiedAt: new Date(),
      status,
    },
  })
  return updated as ArtifactLedgerEntry
}

export async function handoffArtifact(artifactId: string, consumerAgentId: string): Promise<ArtifactLedgerEntry> {
  if (!consumerAgentId?.trim()) throw new Error('Artifact handoff consumerAgentId is required.')
  const current = await db.artifactLedger.findUnique({ where: { artifactId } })
  if (!current) throw new Error(`Artifact not found: ${artifactId}`)
  if (current.status === 'rejected' || current.status === 'superseded') {
    throw new Error(`Artifact ${artifactId} cannot be handed off from status ${current.status}.`)
  }

  const history = parseHandoffs(current.handoffHistory)
  if (!history.some((entry) => entry.consumerAgentId === consumerAgentId)) {
    history.push({ consumerAgentId, handedAt: new Date().toISOString() })
  }

  const updated = await db.artifactLedger.update({
    where: { artifactId },
    data: {
      consumerAgentId,
      status: 'handed_off',
      handoffHistory: serializeHandoffs(history),
    },
  })
  return updated as ArtifactLedgerEntry
}

export async function supersedeArtifact(artifactId: string): Promise<ArtifactLedgerEntry> {
  const updated = await db.artifactLedger.update({ where: { artifactId }, data: { status: 'superseded' } })
  return updated as ArtifactLedgerEntry
}

export async function getArtifact(artifactId: string): Promise<ArtifactLedgerEntry | null> {
  return (await db.artifactLedger.findUnique({ where: { artifactId } })) as ArtifactLedgerEntry | null
}

export async function listMissionArtifacts(missionId: string): Promise<ArtifactLedgerEntry[]> {
  return (await db.artifactLedger.findMany({ where: { missionId }, orderBy: [{ createdAt: 'asc' }, { version: 'asc' }] })) as ArtifactLedgerEntry[]
}

export async function validateArtifactChain(missionId: string): Promise<string[]> {
  const rows = await listMissionArtifacts(missionId)
  const errors: string[] = []
  const ids = new Set<string>()
  const byId = new Map<string, ArtifactLedgerEntry>()

  for (const row of rows) {
    if (ids.has(row.artifactId)) errors.push(`Duplicate artifactId: ${row.artifactId}`)
    ids.add(row.artifactId)
    byId.set(row.artifactId, row)

    if (!row.producerAgentId) errors.push(`Artifact ${row.artifactId} has no producer.`)
    if (!row.contentHash || !/^[a-f0-9]{64}$/.test(row.contentHash)) {
      errors.push(`Artifact ${row.artifactId} has invalid SHA-256 contentHash.`)
    }
    if (row.missionId !== missionId) errors.push(`Artifact ${row.artifactId} is outside mission ${missionId}.`)
    if (row.status === 'verified' && (row.verificationScore === null || !row.verifiedBy || !row.verifiedAt)) {
      errors.push(`Verified artifact ${row.artifactId} is missing verification evidence.`)
    }
    if (row.status === 'handed_off' && !row.consumerAgentId) {
      errors.push(`Artifact ${row.artifactId} is handed_off without a consumer.`)
    }
    if (row.status === 'handed_off' && parseHandoffs(row.handoffHistory).length === 0) {
      errors.push(`Artifact ${row.artifactId} is handed_off without handoff history.`)
    }
    if (row.parentArtifactId) {
      if (row.parentArtifactId === row.artifactId) errors.push(`Artifact ${row.artifactId} references itself.`)
      const parent = byId.get(row.parentArtifactId)
      if (!parent) errors.push(`Artifact ${row.artifactId} references missing parent ${row.parentArtifactId}.`)
      else if (parent.missionId !== row.missionId) errors.push(`Artifact ${row.artifactId} has a cross-mission parent.`)
    }
  }

  // Detect parent-pointer cycles with DFS over the immutable artifact IDs.
  const visit = (artifactId: string, stack: Set<string>) => {
    if (stack.has(artifactId)) {
      errors.push(`Artifact lineage cycle detected at ${artifactId}.`)
      return
    }
    const row = byId.get(artifactId)
    if (!row?.parentArtifactId) return
    if (!byId.has(row.parentArtifactId)) return
    const next = new Set(stack)
    next.add(artifactId)
    visit(row.parentArtifactId, next)
  }
  for (const row of rows) visit(row.artifactId, new Set())

  return [...new Set(errors)]
}
