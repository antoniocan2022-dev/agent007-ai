import { createHash } from 'node:crypto'
import { db } from '@/lib/db'

export type ArtifactStatus = 'draft' | 'submitted' | 'verified' | 'rejected' | 'handed_off' | 'superseded'

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

export async function registerArtifact(input: RegisterArtifactInput): Promise<ArtifactLedgerEntry> {
  const content = input.content ?? input.artifactValue ?? ''
  const artifactId = `artifact_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  const created = await db.artifactLedger.create({
    data: {
      artifactId,
      missionId: input.missionId,
      ventureId: input.ventureId,
      parentArtifactId: input.parentArtifactId,
      stageId: input.stageId,
      artifactType: input.artifactType,
      name: input.name.slice(0, 200),
      version: 1,
      status: input.status ?? 'submitted',
      producerAgentId: input.producerAgentId,
      consumerAgentId: input.consumerAgentId,
      sourceRef: input.sourceRef,
      artifactValue: input.artifactValue?.slice(0, 4000) ?? null,
      contentHash: hashArtifact(content),
      verificationScore: clampScore(input.verificationScore),
      verifiedBy: input.verifiedBy,
      verifiedAt: input.verifiedAt,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
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
  const updated = await db.artifactLedger.update({
    where: { artifactId },
    data: { consumerAgentId, status: 'handed_off' },
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
  return (await db.artifactLedger.findMany({ where: { missionId }, orderBy: { createdAt: 'asc' } })) as ArtifactLedgerEntry[]
}

export async function validateArtifactChain(missionId: string): Promise<string[]> {
  const rows = await listMissionArtifacts(missionId)
  const errors: string[] = []
  const ids = new Set<string>()
  for (const row of rows) {
    if (ids.has(row.artifactId)) errors.push(`Duplicate artifactId: ${row.artifactId}`)
    ids.add(row.artifactId)
    if (!row.producerAgentId) errors.push(`Artifact ${row.artifactId} has no producer.`)
    if (!row.contentHash || !/^[a-f0-9]{64}$/.test(row.contentHash)) errors.push(`Artifact ${row.artifactId} has invalid SHA-256 contentHash.`)
    if (row.status === 'handed_off' && !row.consumerAgentId) errors.push(`Artifact ${row.artifactId} is handed_off without a consumer.`)
    if (row.parentArtifactId && !ids.has(row.parentArtifactId)) {
      const parentExists = rows.some((candidate) => candidate.artifactId === row.parentArtifactId)
      if (!parentExists) errors.push(`Artifact ${row.artifactId} references missing parent ${row.parentArtifactId}.`)
    }
  }
  return errors
}
