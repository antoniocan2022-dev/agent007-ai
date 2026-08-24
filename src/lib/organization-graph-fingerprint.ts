import { createHash } from 'node:crypto'
import { COMMERCIAL_ORGANIZATION } from './commercial-organization'

export function canonicalOrganizationGraph() {
  return [...COMMERCIAL_ORGANIZATION]
    .map((node) => ({
      id: node.id,
      title: node.title,
      division: node.division,
      mission: node.mission,
      level: node.level,
      reportsTo: node.reportsTo,
      businesses: [...node.businesses].sort(),
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

export function organizationGraphFingerprint(): string {
  return createHash('sha256').update(JSON.stringify(canonicalOrganizationGraph())).digest('hex')
}
