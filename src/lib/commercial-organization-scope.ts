import { db } from './db'
import {
  businessScopeFor,
  leadersForBusiness,
  specialistsForBusiness,
  supportsBusiness,
  type CommercialLeader,
  type CommercialNode,
} from './commercial-organization'

export interface VentureOrganizationScope {
  ventureId: string
  businessKey: string
  operationalOwnerId: string | null
  leaderIds: readonly string[]
  sharedLeaderIds: readonly string[]
  ventureSpecificLeaderIds: readonly string[]
  specialistIds: readonly string[]
}

export function leaderBusinesses(leaderId: string): readonly string[] {
  return businessScopeFor(leaderId)
}

export function businessLeaders(businessId: string): readonly CommercialLeader[] {
  return leadersForBusiness(businessId)
}

export function sharedLeaders(businessId: string): readonly CommercialLeader[] {
  return businessLeaders(businessId).filter((leader) => leader.businesses.length > 1)
}

export function ventureSpecificLeaders(businessId: string): readonly CommercialLeader[] {
  return businessLeaders(businessId).filter((leader) => leader.businesses.length === 1)
}

export function businessSpecialists(businessId: string): readonly CommercialNode[] {
  return specialistsForBusiness(businessId)
}

export function leaderSupportsBusiness(leaderId: string, businessId: string): boolean {
  return supportsBusiness(leaderId, businessId)
}

export function operationalOwnerForBusiness(businessId: string): CommercialLeader | null {
  const dedicated = ventureSpecificLeaders(businessId)
  return dedicated.length === 1 ? dedicated[0] : null
}

export async function businessKeyForVenture(ventureId: string): Promise<string> {
  const id = ventureId.trim()
  if (!id) throw new Error('ventureId is required to resolve organizational scope.')
  const rows = await db.$queryRaw<Array<{ businessKey: string }>>`
    SELECT bu."businessKey"
    FROM "Venture" v
    INNER JOIN "BusinessUnit" bu ON bu."id" = v."businessUnitId"
    WHERE v."id" = ${id}
    LIMIT 1
  `
  const businessKey = rows[0]?.businessKey?.trim().toLowerCase()
  if (!businessKey) throw new Error(`Venture ${id} has no canonical BusinessUnit scope.`)
  return businessKey
}

export async function resolveVentureOrganizationScope(ventureId: string): Promise<VentureOrganizationScope> {
  const id = ventureId.trim()
  const businessKey = await businessKeyForVenture(id)
  const leaders = businessLeaders(businessKey)
  const dedicated = ventureSpecificLeaders(businessKey)
  if (leaders.length === 0) throw new Error(`Business ${businessKey} has no commercial leader.`)
  if (dedicated.length > 1) throw new Error(`Business ${businessKey} has multiple venture-specific operational owners: ${dedicated.map((leader) => leader.id).join(', ')}.`)

  return {
    ventureId: id,
    businessKey,
    operationalOwnerId: dedicated[0]?.id ?? null,
    leaderIds: leaders.map((leader) => leader.id),
    sharedLeaderIds: sharedLeaders(businessKey).map((leader) => leader.id),
    ventureSpecificLeaderIds: dedicated.map((leader) => leader.id),
    specialistIds: businessSpecialists(businessKey).map((specialist) => specialist.id),
  }
}
