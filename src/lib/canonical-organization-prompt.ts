import { COMMERCIAL_LEADERS, COMMERCIAL_SPECIALISTS, getCommercialDivisions, getCommercialBusinesses } from './commercial-organization'

export interface CanonicalOrganizationFacts {
  leaderCount: number
  specialistCount: number
  divisionCount: number
  businessCount: number
  leaderIds: readonly string[]
  divisionNames: readonly string[]
  businessKeys: readonly string[]
}

export function getCanonicalOrganizationFacts(): CanonicalOrganizationFacts {
  return {
    leaderCount: COMMERCIAL_LEADERS.filter((node) => node.level === 'LEADER').length,
    specialistCount: COMMERCIAL_SPECIALISTS.length,
    divisionCount: getCommercialDivisions().length,
    businessCount: getCommercialBusinesses().length,
    leaderIds: COMMERCIAL_LEADERS.filter((node) => node.level === 'LEADER').map((node) => node.id),
    divisionNames: getCommercialDivisions(),
    businessKeys: getCommercialBusinesses(),
  }
}

export function getCanonicalOrganizationPrompt(): string {
  const facts = getCanonicalOrganizationFacts()
  return [
    `CANONICAL ORGANIZATION: ${facts.leaderCount} executive leaders, ${facts.specialistCount} specialists, ${facts.divisionCount} divisions, ${facts.businessCount} businesses.`,
    `LEADERS: ${facts.leaderIds.join('|')}.`,
    `DIVISIONS: ${facts.divisionNames.join(' | ')}.`,
    `BUSINESS SCOPE: ${facts.businessKeys.join(' | ')}.`,
    'ORGANIZATIONAL TRUTH: hierarchy, reporting relationships, authority level, and business scope are derived from the canonical commercial organization graph. Do not invent or hardcode a different team structure.',
  ].join('\n')
}
