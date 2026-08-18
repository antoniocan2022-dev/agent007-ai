/**
 * Venture OS Venture Factory — Upgrade 17.
 *
 * The factory generates deterministic structural venture blueprints only.
 * It creates a DRAFT Venture Control Contract for each future shell so the
 * object is structurally governable, but it never creates readiness evidence,
 * customers, revenue, payments, or launch authorization.
 */

import { createHash } from 'node:crypto'
import { db } from './db'
import { buildVentureBlueprint, CANONICAL_VENTURE_TEMPLATE, validateCanonicalVentureTemplate, type VentureBlueprint } from './venture-template'
import { createVentureControlContract } from './architecture-control-plane'

const FACTORY_CATEGORY = 'venture_factory_blueprint'
const FACTORY_PREFIX = 'venture-os:factory:'

export interface VentureFactorySpec {
  ventureId: string
  name: string
  type: VentureBlueprint['type']
  description: string
  targetMarket: string
  pricingModel: string
}

export interface VentureFactoryResult {
  created: boolean
  repaired: boolean
  blueprint: VentureBlueprint
}

const factoryKey = (ventureId: string) => `${FACTORY_PREFIX}${ventureId}`

function deterministicFactoryId(ventureId: string): string {
  return `factory_${createHash('sha256').update(ventureId.trim()).digest('hex').slice(0, 24)}`
}

export function validateVentureFactorySpec(spec: VentureFactorySpec): string[] {
  const errors = validateCanonicalVentureTemplate()
  const ventureId = spec.ventureId.trim().toLowerCase()
  if (!/^venture_00[23]$/.test(ventureId)) errors.push('Factory currently supports only venture_002 and venture_003 structural shells.')
  if (ventureId === 'venture_001') errors.push('Venture 001 is canonical and is not a factory target.')
  if (!spec.name.trim()) errors.push('Venture name is required.')
  if (!spec.description.trim()) errors.push('Venture description is required.')
  if (!spec.targetMarket.trim()) errors.push('Venture target market is required.')
  if (!spec.pricingModel.trim()) errors.push('Venture pricing model is required.')
  return [...new Set(errors)]
}

function normalizeSpec(spec: VentureFactorySpec): VentureFactorySpec {
  return {
    ventureId: spec.ventureId.trim().toLowerCase(),
    name: spec.name.trim(),
    type: spec.type,
    description: spec.description.trim(),
    targetMarket: spec.targetMarket.trim(),
    pricingModel: spec.pricingModel.trim(),
  }
}

/** Build and persist a single deterministic V002/V003 blueprint idempotently. */
export async function buildVentureShell(specInput: VentureFactorySpec): Promise<VentureFactoryResult> {
  const spec = normalizeSpec(specInput)
  const errors = validateVentureFactorySpec(spec)
  if (errors.length) throw new Error(`Venture factory validation failed: ${errors.join(' | ')}`)

  const key = factoryKey(spec.ventureId)
  const existing = await db.memory.findUnique({ where: { key } })
  if (existing) {
    const blueprint = JSON.parse(existing.value) as VentureBlueprint
    if (blueprint.templateKey !== CANONICAL_VENTURE_TEMPLATE.templateKey || blueprint.templateVersion !== CANONICAL_VENTURE_TEMPLATE.version) {
      throw new Error(`Factory blueprint ${spec.ventureId} uses a non-canonical template version and cannot be silently repaired.`)
    }
    const contract = await createVentureControlContract(spec.ventureId)
    if (contract.status !== 'DRAFT') throw new Error(`Future venture ${spec.ventureId} must retain a DRAFT control contract.`)
    return { created: false, repaired: false, blueprint }
  }

  const blueprint = buildVentureBlueprint(spec)
  const value = JSON.stringify({
    ...blueprint,
    factoryRecordId: deterministicFactoryId(spec.ventureId),
    generatedBy: 'venture_factory',
    generatedAt: blueprint.createdAt,
    productionState: 'STRUCTURAL_ONLY',
    realEvidencePresent: false,
    realRevenuePresent: false,
    realCustomersPresent: false,
    launchAuthorized: false,
    readinessStatus: 'BLOCKED',
  })

  await db.memory.create({ data: { key, value, category: FACTORY_CATEGORY } }).catch(() => {})
  const confirmed = await db.memory.findUnique({ where: { key } })
  if (!confirmed) throw new Error(`Factory could not persist ${spec.ventureId}.`)

  const contract = await createVentureControlContract(spec.ventureId)
  if (contract.status !== 'DRAFT') throw new Error(`Future venture ${spec.ventureId} must start with a DRAFT control contract.`)
  const persisted = JSON.parse(confirmed.value) as VentureBlueprint & { launchAuthorized?: boolean; readinessStatus?: string }
  if (persisted.launchAuthorized !== false) throw new Error(`Factory safety invariant failed for ${spec.ventureId}: launch cannot be authorized by factory generation.`)
  if (persisted.readinessStatus !== 'BLOCKED') throw new Error(`Factory safety invariant failed for ${spec.ventureId}: future ventures must begin BLOCKED.`)

  return { created: true, repaired: false, blueprint: persisted }
}

/** Generate both future shells using explicit specs; no implicit business assumptions are invented. */
export async function buildV002V003Factory(specs: [VentureFactorySpec, VentureFactorySpec]): Promise<VentureFactoryResult[]> {
  const ids = specs.map((spec) => spec.ventureId.trim().toLowerCase())
  if (ids.includes('venture_001')) throw new Error('Venture 001 is canonical and cannot be included in the future venture factory.')
  if (new Set(ids).size !== 2 || !ids.includes('venture_002') || !ids.includes('venture_003')) throw new Error('The factory requires exactly one V002 specification and one V003 specification.')
  return Promise.all(specs.map((spec) => buildVentureShell(spec)))
}

export async function getVentureFactoryBlueprint(ventureId: string): Promise<VentureBlueprint | null> {
  const id = ventureId.trim().toLowerCase()
  if (!/^venture_00[23]$/.test(id)) return null
  const row = await db.memory.findUnique({ where: { key: factoryKey(id) } })
  return row ? JSON.parse(row.value) as VentureBlueprint : null
}

export async function listVentureFactoryBlueprints(): Promise<VentureBlueprint[]> {
  const rows = await db.memory.findMany({ where: { category: FACTORY_CATEGORY }, orderBy: { createdAt: 'asc' }, take: 100 })
  return rows.map((row) => { try { return JSON.parse(row.value) as VentureBlueprint } catch { return null } }).filter((item): item is VentureBlueprint => Boolean(item))
}
