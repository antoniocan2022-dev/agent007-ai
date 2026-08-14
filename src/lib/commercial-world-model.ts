/**
 * Commercial World Model
 *
 * Relationship-aware projection over the existing commercial control plane.
 * It stores references to source records, not duplicate business records.
 */
import { createHash } from 'node:crypto'
import { db } from './db'
import { COMMERCIAL_CATEGORIES, isCommercialBusiness, type CommercialBusiness } from './commercial-control-plane'

export type CommercialWorldEntityType = 'tenant' | 'customer' | 'workflow' | 'event' | 'provider' | 'external_action' | 'billing' | 'evidence' | 'credential' | 'business'
export type CommercialWorldRelationType = 'owns' | 'contains' | 'generated' | 'targets' | 'depends_on' | 'resulted_in' | 'uses' | 'supports' | 'belongs_to'

export interface CommercialWorldEntity {
  entityId: string
  tenantId: string
  business: CommercialBusiness
  type: CommercialWorldEntityType
  sourceCategory: string
  sourceId: string
  label: string
  attributes: Record<string, string | number | boolean | null>
  observedAt: string
  createdAt: string
  updatedAt: string
}

export interface CommercialWorldRelation {
  relationId: string
  tenantId: string
  business: CommercialBusiness
  fromEntityId: string
  toEntityId: string
  type: CommercialWorldRelationType
  confidence: number
  source: string
  createdAt: string
}

export interface CommercialWorldSnapshot {
  tenantId: string
  business: CommercialBusiness | null
  version: 1
  generatedAt: string
  entities: CommercialWorldEntity[]
  relations: CommercialWorldRelation[]
  integrity: { ok: boolean; issues: string[] }
}

const ENTITY_CATEGORY = 'commercial_world_entity'
const RELATION_CATEGORY = 'commercial_world_relation'
const clean = (value: string) => value.trim().replace(/\s+/g, ' ')
const now = () => new Date().toISOString()
const clamp = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
const entityKey = (tenantId: string, type: string, sourceId: string) => `commercial-world:entity:${tenantId}:${type}:${sourceId}`
const relationKey = (tenantId: string, from: string, to: string, type: string) => `commercial-world:relation:${tenantId}:${from}:${type}:${to}`

function entityId(tenantId: string, type: string, sourceId: string): string {
  return `cwe_${createHash('sha256').update(`${tenantId}|${type}|${sourceId}`).digest('hex').slice(0, 24)}`
}

function parse<T>(value: string): T | null {
  try { return JSON.parse(value) as T } catch { return null }
}

async function readCategory<T>(category: string, tenantId: string, limit = 5000): Promise<T[]> {
  const rows = await db.memory.findMany({ where: { category }, orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(limit, 1), 5000) })
  return rows.map((row) => parse<T>(row.value)).filter((value): value is T => !!value && (value as { tenantId?: string }).tenantId === tenantId)
}

async function readEntities(tenantId: string, business?: CommercialBusiness): Promise<CommercialWorldEntity[]> {
  const rows = await db.memory.findMany({ where: { category: ENTITY_CATEGORY }, orderBy: { createdAt: 'desc' }, take: 5000 })
  return rows.map((row) => parse<CommercialWorldEntity>(row.value)).filter((value): value is CommercialWorldEntity => !!value && value.tenantId === tenantId && (!business || value.business === business))
}

async function readRelations(tenantId: string, business?: CommercialBusiness): Promise<CommercialWorldRelation[]> {
  const rows = await db.memory.findMany({ where: { category: RELATION_CATEGORY }, orderBy: { createdAt: 'desc' }, take: 5000 })
  return rows.map((row) => parse<CommercialWorldRelation>(row.value)).filter((value): value is CommercialWorldRelation => !!value && value.tenantId === tenantId && (!business || value.business === business))
}

export async function upsertCommercialWorldEntity(input: Omit<CommercialWorldEntity, 'entityId' | 'createdAt' | 'updatedAt'>): Promise<CommercialWorldEntity> {
  if (!input.tenantId.trim() || !isCommercialBusiness(input.business) || !clean(input.sourceCategory) || !clean(input.sourceId) || !clean(input.type)) throw new Error('tenantId, business, type, sourceCategory, and sourceId are required.')
  const timestamp = now()
  const id = entityId(input.tenantId, input.type, input.sourceId)
  const recordKey = entityKey(input.tenantId, input.type, input.sourceId)
  const existing = await db.memory.findUnique({ where: { key: recordKey } })
  if (existing) {
    const current = parse<CommercialWorldEntity>(existing.value)
    if (!current) throw new Error('Commercial world entity record is corrupt.')
    const updated = { ...current, ...input, entityId: id, updatedAt: timestamp }
    await db.memory.update({ where: { id: existing.id }, data: { value: JSON.stringify(updated) } })
    return updated
  }
  const created: CommercialWorldEntity = { ...input, entityId: id, type: input.type, sourceCategory: clean(input.sourceCategory), sourceId: clean(input.sourceId), label: clean(input.label), attributes: input.attributes ?? {}, observedAt: input.observedAt, createdAt: timestamp, updatedAt: timestamp }
  await db.memory.create({ data: { key: recordKey, category: ENTITY_CATEGORY, value: JSON.stringify(created) } })
  return created
}

export async function upsertCommercialWorldRelation(input: Omit<CommercialWorldRelation, 'relationId' | 'createdAt'>): Promise<CommercialWorldRelation> {
  if (!input.tenantId.trim() || !isCommercialBusiness(input.business) || !input.fromEntityId || !input.toEntityId || input.fromEntityId === input.toEntityId) throw new Error('Valid relation endpoints are required.')
  const timestamp = now()
  const relationId = `cwr_${createHash('sha256').update(`${input.tenantId}|${input.fromEntityId}|${input.type}|${input.toEntityId}`).digest('hex').slice(0, 24)}`
  const recordKey = relationKey(input.tenantId, input.fromEntityId, input.toEntityId, input.type)
  const relation: CommercialWorldRelation = { ...input, relationId, confidence: clamp(input.confidence), source: clean(input.source), createdAt: timestamp }
  const existing = await db.memory.findUnique({ where: { key: recordKey } })
  if (existing) {
    await db.memory.update({ where: { id: existing.id }, data: { value: JSON.stringify(relation) } })
    return relation
  }
  await db.memory.create({ data: { key: recordKey, category: RELATION_CATEGORY, value: JSON.stringify(relation) } })
  return relation
}

export async function projectCommercialWorld(tenantId: string, business?: CommercialBusiness): Promise<CommercialWorldSnapshot> {
  if (!tenantId.trim()) throw new Error('tenantId is required.')
  const businesses = business ? [business] : (['revenue-recovery', 'operations-kit', 'career-command'] as const)
  for (const currentBusiness of businesses) {
    const tenants = (await readCategory<{ tenantId: string; business?: CommercialBusiness[]; name?: string; updatedAt: string }>(COMMERCIAL_CATEGORIES.tenant, tenantId)).filter((item) => item.tenantId === tenantId)
    for (const tenant of tenants) {
      await upsertCommercialWorldEntity({ tenantId, business: currentBusiness, type: 'tenant', sourceCategory: COMMERCIAL_CATEGORIES.tenant, sourceId: tenant.tenantId, label: tenant.name ?? tenant.tenantId, attributes: {}, observedAt: tenant.updatedAt })
    }
    const customers = await readCategory<{ customerId: string; tenantId: string; business: CommercialBusiness; name: string; status: string; value: number; updatedAt: string }>(COMMERCIAL_CATEGORIES.customer, tenantId)
    for (const customer of customers.filter((item) => item.business === currentBusiness)) {
      await upsertCommercialWorldEntity({ tenantId, business: currentBusiness, type: 'customer', sourceCategory: COMMERCIAL_CATEGORIES.customer, sourceId: customer.customerId, label: customer.name, attributes: { status: customer.status, value: customer.value }, observedAt: customer.updatedAt })
    }
    const workflows = await readCategory<{ workflowId: string; tenantId: string; business: CommercialBusiness; workflowType: string; status: string; updatedAt: string }>(COMMERCIAL_CATEGORIES.workflow, tenantId)
    for (const workflow of workflows.filter((item) => item.business === currentBusiness)) {
      await upsertCommercialWorldEntity({ tenantId, business: currentBusiness, type: 'workflow', sourceCategory: COMMERCIAL_CATEGORIES.workflow, sourceId: workflow.workflowId, label: workflow.workflowType, attributes: { status: workflow.status }, observedAt: workflow.updatedAt })
    }
    const events = await readCategory<{ eventId: string; tenantId: string; business: CommercialBusiness; type: string; entityId: string | null; status: string; acceptedAt: string }>(COMMERCIAL_CATEGORIES.event, tenantId)
    for (const event of events.filter((item) => item.business === currentBusiness)) {
      await upsertCommercialWorldEntity({ tenantId, business: currentBusiness, type: 'event', sourceCategory: COMMERCIAL_CATEGORIES.event, sourceId: event.eventId, label: event.type, attributes: { status: event.status }, observedAt: event.acceptedAt })
    }
    const providers = await readCategory<{ providerId: string; name: string; status: string; updatedAt: string }>(COMMERCIAL_CATEGORIES.provider, tenantId).catch(() => [])
    for (const provider of providers) {
      await upsertCommercialWorldEntity({ tenantId, business: currentBusiness, type: 'provider', sourceCategory: COMMERCIAL_CATEGORIES.provider, sourceId: provider.providerId, label: provider.name, attributes: { status: provider.status }, observedAt: provider.updatedAt })
    }
  }
  const entities = await readEntities(tenantId, business)
  const relations: CommercialWorldRelation[] = []
  const tenantEntities = entities.filter((entity) => entity.type === 'tenant')
  for (const entity of entities) {
    const owner = tenantEntities.find((tenant) => tenant.sourceId === entity.sourceId && tenant.business === entity.business)
    if (owner && owner.entityId !== entity.entityId) relations.push(await upsertCommercialWorldRelation({ tenantId, business: entity.business, fromEntityId: owner.entityId, toEntityId: entity.entityId, type: 'contains', confidence: 1, source: 'commercial-control-plane-projection' }))
  }
  const eventRecords = await readCategory<{ eventId: string; business: CommercialBusiness; entityId: string | null; type: string }>(COMMERCIAL_CATEGORIES.event, tenantId)
  for (const event of eventRecords.filter((item) => !business || item.business === business)) {
    if (!event.entityId) continue
    const eventEntity = entities.find((entity) => entity.type === 'event' && entity.sourceId === event.eventId)
    const target = entities.find((entity) => entity.sourceId === event.entityId && entity.business === event.business)
    if (eventEntity && target) relations.push(await upsertCommercialWorldRelation({ tenantId, business: event.business, fromEntityId: eventEntity.entityId, toEntityId: target.entityId, type: 'targets', confidence: 0.95, source: 'commercial-event.entityId' }))
  }
  const snapshot = await getCommercialWorldSnapshot(tenantId, business)
  return { ...snapshot, relations }
}

export async function getCommercialWorldSnapshot(tenantId: string, business?: CommercialBusiness): Promise<CommercialWorldSnapshot> {
  const entities = await readEntities(tenantId, business)
  const relations = await readRelations(tenantId, business)
  const entityIds = new Set(entities.map((entity) => entity.entityId))
  const issues: string[] = []
  const relationIds = new Set<string>()
  for (const relation of relations) {
    if (relationIds.has(relation.relationId)) issues.push(`Duplicate world relation ${relation.relationId}.`)
    relationIds.add(relation.relationId)
    if (!entityIds.has(relation.fromEntityId) || !entityIds.has(relation.toEntityId)) issues.push(`Dangling world relation ${relation.relationId}.`)
  }
  const sourceKeys = new Set<string>()
  for (const entity of entities) {
    const sourceKey = `${entity.type}:${entity.sourceCategory}:${entity.sourceId}`
    if (sourceKeys.has(sourceKey)) issues.push(`Duplicate world projection ${sourceKey}.`)
    sourceKeys.add(sourceKey)
  }
  return { tenantId, business: business ?? null, version: 1, generatedAt: now(), entities, relations, integrity: { ok: issues.length === 0, issues: [...new Set(issues)] } }
}

export function validateCommercialWorldModelContracts(): string[] {
  const types: CommercialWorldEntityType[] = ['tenant', 'customer', 'workflow', 'event', 'provider', 'external_action', 'billing', 'evidence', 'credential', 'business']
  const relations: CommercialWorldRelationType[] = ['owns', 'contains', 'generated', 'targets', 'depends_on', 'resulted_in', 'uses', 'supports', 'belongs_to']
  const errors: string[] = []
  if (new Set(types).size !== types.length) errors.push('Commercial world entity types must be unique.')
  if (new Set(relations).size !== relations.length) errors.push('Commercial world relation types must be unique.')
  return errors
}
