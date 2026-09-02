import type { CeoExecutionContract, EvidenceDomain, EvidenceOperation } from './ceo-cognitive-contract'

export type CapabilityDomain = 'research' | 'finance' | 'market_intelligence' | 'communication' | 'commerce' | 'crm' | 'documents' | 'calendar' | 'email' | 'github' | 'cloud' | 'monitoring' | 'analytics' | 'security' | 'operations'
export interface FunctionDescriptor { id: string; description: string }
export interface ToolDescriptor { id: string; description: string; reliability: number; freshness: number; latencyMs: number; cost: number; risk: number; permissions: string[]; functions: FunctionDescriptor[] }
export interface ServiceDescriptor { id: string; description: string; tools: ToolDescriptor[] }
export interface CapabilityDescriptor { id: string; domain: CapabilityDomain; description: string; services: ServiceDescriptor[] }
export interface EnterpriseCapability { id: CapabilityDomain; description: string; capabilities: CapabilityDescriptor[] }

const capability = (domain: CapabilityDomain, id: string, description: string, tools: ToolDescriptor[] = []): CapabilityDescriptor => ({ id, domain, description, services: [{ id: `${id}.service`, description: `${description} service`, tools }] })
const tool = (id: string, description: string, reliability = 0.8, freshness = 0.8, latencyMs = 5000, cost = 0, risk = 0.2, permissions: string[] = []): ToolDescriptor => ({ id, description, reliability, freshness, latencyMs, cost, risk, permissions, functions: [{ id: `${id}.execute`, description }] })

export const CEO_CAPABILITY_ARCHITECTURE: readonly EnterpriseCapability[] = Object.freeze([
  { id: 'research', description: 'General external and internal research', capabilities: [capability('research', 'research.general', 'Research and source acquisition', [tool('web_search', 'Search external sources', 0.82, 0.95, 6500), tool('page_reader', 'Read an identified source', 0.9, 0.92, 5000)])] },
  { id: 'finance', description: 'Financial analysis and internal finance operations', capabilities: [capability('finance', 'finance.analysis', 'Analyze financial information')] },
  { id: 'market_intelligence', description: 'Market, competitor and industry intelligence', capabilities: [capability('market_intelligence', 'market.competitive', 'Competitive and market intelligence', [tool('web_search', 'Acquire current market intelligence', 0.82, 0.95, 6500)])] },
  { id: 'communication', description: 'Communications and external messaging', capabilities: [capability('communication', 'communication.messaging', 'Create and send governed communications')] },
  { id: 'commerce', description: 'Commerce, orders and transactions', capabilities: [capability('commerce', 'commerce.execution', 'Governed commerce operations')] },
  { id: 'crm', description: 'Customer relationship management', capabilities: [capability('crm', 'crm.relationships', 'Customer and account operations')] },
  { id: 'documents', description: 'Document creation, reading and management', capabilities: [capability('documents', 'documents.management', 'Document workflows')] },
  { id: 'calendar', description: 'Calendar scheduling and commitments', capabilities: [capability('calendar', 'calendar.management', 'Calendar workflows')] },
  { id: 'email', description: 'Email retrieval and governed sending', capabilities: [capability('email', 'email.management', 'Email workflows')] },
  { id: 'github', description: 'Repository, code and delivery operations', capabilities: [capability('github', 'github.development', 'GitHub engineering operations')] },
  { id: 'cloud', description: 'Cloud infrastructure and deployment operations', capabilities: [capability('cloud', 'cloud.infrastructure', 'Cloud operations')] },
  { id: 'monitoring', description: 'Runtime monitoring and incident observation', capabilities: [capability('monitoring', 'monitoring.runtime', 'Runtime observation')] },
  { id: 'analytics', description: 'Metrics, analytics and performance analysis', capabilities: [capability('analytics', 'analytics.performance', 'Performance analysis')] },
  { id: 'security', description: 'Security, controls and risk management', capabilities: [capability('security', 'security.controls', 'Security operations')] },
  { id: 'operations', description: 'Internal operations and controlled execution', capabilities: [capability('operations', 'operations.execution', 'Operational workflows')] },
] as const)

export function capabilityForDomain(domain: EvidenceDomain): CapabilityDomain {
  if (domain === 'public_equity' || domain === 'market' || domain === 'competitor') return 'market_intelligence'
  if (domain === 'news' || domain === 'general_web' || domain === 'business_due_diligence') return 'research'
  if (domain === 'regulatory') return 'security'
  if (domain === 'internal_finance') return 'finance'
  if (domain === 'internal_operations' || domain === 'live_system') return 'operations'
  return 'research'
}

export function capabilitiesForDecision(contract: Pick<CeoExecutionContract, 'domain' | 'operation' | 'intent'>): string[] {
  const result = new Set<string>()
  result.add(capabilityForDomain(contract.domain))
  if (contract.operation === 'verify') result.add('monitoring')
  if (contract.intent === 'production_action' || contract.intent === 'tool_action') result.add('operations')
  if (contract.intent === 'research') result.add('research')
  return [...result]
}

export function findCapability(id: string): CapabilityDescriptor | undefined {
  for (const enterprise of CEO_CAPABILITY_ARCHITECTURE) for (const item of enterprise.capabilities) if (item.id === id) return item
  return undefined
}

export function capabilityNeedFromDecision(contract: CeoExecutionContract): { domain: CapabilityDomain; operation: EvidenceOperation; capabilities: string[] } {
  return { domain: capabilityForDomain(contract.domain), operation: contract.operation, capabilities: capabilitiesForDecision(contract) }
}