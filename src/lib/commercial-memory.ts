/**
 * Commercial Memory
 *
 * A domain-specific memory layer built on the existing Agent007 DB memory
 * store. It stores durable commercial facts, decisions and outcomes without
 * introducing a second persistence system. The entry references evidence and
 * business entities instead of copying their source records.
 */
import { createHash } from 'node:crypto'
import { db } from './db'
import { isCommercialBusiness, type CommercialBusiness } from './commercial-control-plane'

export type CommercialMemoryKind = 'fact' | 'decision' | 'outcome' | 'preference' | 'lesson' | 'risk'

export interface CommercialMemoryEntry {
  memoryId: string
  tenantId: string
  business: CommercialBusiness
  scope: string
  kind: CommercialMemoryKind
  subjectType: string
  subjectId: string | null
  statement: string
  source: string
  evidenceIds: string[]
  confidence: number
  importance: number
  tags: string[]
  occurredAt: string
  createdAt: string
  updatedAt: string
  recallCount: number
}

export interface CommercialMemoryQuery {
  tenantId: string
  business?: CommercialBusiness
  query: string
  kind?: CommercialMemoryKind
  scope?: string
  subjectId?: string
  limit?: number
}

const CATEGORY = 'commercial_memory'
const clean = (value: string) => value.trim().replace(/\s+/g, ' ')
const now = () => new Date().toISOString()
const clamp = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
const normalize = (value: string) => clean(value).toLowerCase()

function fingerprint(input: Pick<CommercialMemoryEntry, 'business' | 'scope' | 'kind' | 'subjectType' | 'subjectId' | 'statement'>): string {
  return createHash('sha256')
    .update([input.business, input.scope, input.kind, input.subjectType, input.subjectId ?? '', normalize(input.statement)].join('|'))
    .digest('hex')
}

function key(tenantId: string, fingerprintValue: string): string {
  return `commercial-memory:${tenantId}:${fingerprintValue}`
}

function parse(record: { value: string }): CommercialMemoryEntry | null {
  try {
    const value = JSON.parse(record.value) as CommercialMemoryEntry
    return value && typeof value.memoryId === 'string' ? value : null
  } catch {
    return null
  }
}

async function read(tenantId: string, limit = 5000): Promise<CommercialMemoryEntry[]> {
  const rows = await db.memory.findMany({
    where: { category: CATEGORY },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 5000),
  })
  return rows.map(parse).filter((entry): entry is CommercialMemoryEntry => !!entry && entry.tenantId === tenantId)
}

export async function rememberCommercial(input: Omit<CommercialMemoryEntry, 'memoryId' | 'createdAt' | 'updatedAt' | 'recallCount'>): Promise<{ created: boolean; memory: CommercialMemoryEntry }> {
  if (!input.tenantId.trim() || !isCommercialBusiness(input.business)) throw new Error('Valid tenantId and business are required.')
  const statement = clean(input.statement)
  const source = clean(input.source)
  const scope = clean(input.scope)
  const subjectType = clean(input.subjectType)
  if (!statement || !source || !scope || !subjectType) throw new Error('statement, source, scope, and subjectType are required.')
  const timestamp = now()
  const identity = fingerprint({ ...input, statement, scope, subjectType })
  const recordKey = key(input.tenantId, identity)
  const existing = await db.memory.findUnique({ where: { key: recordKey } })
  if (existing) {
    const memory = parse(existing)
    if (!memory) throw new Error('Commercial memory record is corrupt.')
    return { created: false, memory }
  }
  const memory: CommercialMemoryEntry = {
    memoryId: `cm_${identity.slice(0, 24)}`,
    tenantId: input.tenantId,
    business: input.business,
    scope,
    kind: input.kind,
    subjectType,
    subjectId: input.subjectId?.trim() || null,
    statement,
    source,
    evidenceIds: [...new Set(input.evidenceIds.map(clean).filter(Boolean))],
    confidence: clamp(input.confidence),
    importance: clamp(input.importance),
    tags: [...new Set(input.tags.map(normalize).filter(Boolean))],
    occurredAt: input.occurredAt,
    createdAt: timestamp,
    updatedAt: timestamp,
    recallCount: 0,
  }
  await db.memory.create({ data: { key: recordKey, category: CATEGORY, value: JSON.stringify(memory) } })
  return { created: true, memory }
}

export async function recallCommercialMemory(query: CommercialMemoryQuery): Promise<CommercialMemoryEntry[]> {
  if (!query.tenantId.trim() || !query.query.trim()) return []
  const words = normalize(query.query).split(/\s+/).filter((word) => word.length > 2)
  const entries = await read(query.tenantId)
  const filtered = entries.filter((entry) =>
    (!query.business || entry.business === query.business) &&
    (!query.kind || entry.kind === query.kind) &&
    (!query.scope || entry.scope === query.scope) &&
    (!query.subjectId || entry.subjectId === query.subjectId)
  )
  const ranked = filtered.map((entry) => {
    const text = `${entry.statement} ${entry.source} ${entry.scope} ${entry.subjectType} ${entry.tags.join(' ')}`.toLowerCase()
    const lexical = words.reduce((score, word) => score + (text.includes(word) ? 1 : 0), 0)
    const exactSubject = query.subjectId && entry.subjectId === query.subjectId ? 2 : 0
    const quality = entry.confidence * 2 + entry.importance
    return { entry, score: lexical * 3 + exactSubject + quality }
  }).filter((item) => words.length === 0 || item.score > 0)
    .sort((a, b) => b.score - a.score || b.entry.occurredAt.localeCompare(a.entry.occurredAt))
    .slice(0, Math.min(Math.max(query.limit ?? 10, 1), 100))
  for (const item of ranked) item.entry.recallCount += 1
  await Promise.all(ranked.map(async ({ entry }) => {
    const fp = fingerprint(entry)
    const record = await db.memory.findUnique({ where: { key: key(query.tenantId, fp) } })
    if (record) await db.memory.update({ where: { id: record.id }, data: { value: JSON.stringify(entry) } })
  }))
  return ranked.map((item) => item.entry)
}

export async function reinforceCommercialMemory(memoryId: string, tenantId: string, outcome: 'confirmed' | 'refuted' | 'stale'): Promise<CommercialMemoryEntry | null> {
  const entries = await read(tenantId)
  const current = entries.find((entry) => entry.memoryId === memoryId)
  if (!current) return null
  const delta = outcome === 'confirmed' ? 0.05 : outcome === 'refuted' ? -0.1 : -0.02
  const updated: CommercialMemoryEntry = {
    ...current,
    confidence: clamp(current.confidence + delta),
    updatedAt: now(),
  }
  const record = await db.memory.findUnique({ where: { key: key(tenantId, fingerprint(current)) } })
  if (!record) throw new Error('Commercial memory persistence record is missing.')
  await db.memory.update({ where: { id: record.id }, data: { value: JSON.stringify(updated) } })
  return updated
}

export async function listCommercialMemory(tenantId: string, business?: CommercialBusiness, limit = 100): Promise<CommercialMemoryEntry[]> {
  return (await read(tenantId, Math.min(Math.max(limit, 1), 5000))).filter((entry) => !business || entry.business === business).slice(0, Math.min(Math.max(limit, 1), 500))
}

export function validateCommercialMemoryContracts(): string[] {
  const errors: string[] = []
  const kinds: CommercialMemoryKind[] = ['fact', 'decision', 'outcome', 'preference', 'lesson', 'risk']
  if (new Set(kinds).size !== kinds.length) errors.push('Commercial memory kinds must be unique.')
  if (kinds.length !== 6) errors.push('Commercial memory taxonomy must contain six kinds.')
  return errors
}
