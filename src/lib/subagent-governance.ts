import type { Subagent } from './subagents'
import { PROVIDER_PRIORITY } from './provider-intelligence-policy'

export type SubagentClass = 'director' | 'intelligence' | 'creation' | 'product-engineering' | 'revenue-market' | 'analytics-optimization' | 'governance' | 'security' | 'operations'
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'
export type VerificationTier = 'standard' | 'enhanced' | 'strict' | 'dual-review'
/**
 * OpenAI remains a legacy type for backward compatibility only. It is not an
 * active governed provider and is intentionally excluded from PROVIDER_PRIORITY.
 */
export type ProviderId = 'groq' | 'openai' | 'zai' | 'mistral' | 'gemini' | 'cerebras'
export type TaskType = 'general' | 'research' | 'reasoning' | 'coding' | 'creative' | 'financial' | 'security' | 'operations' | 'analysis'

export interface SubagentGovernanceProfile {
  id: string
  division: string
  class: SubagentClass
  reportsTo: string
  mission: string
  riskLevel: RiskLevel
  verificationTier: VerificationTier
  providerOrder: readonly ProviderId[]
  taskTypes: readonly TaskType[]
  mustEscalateFor: readonly string[]
  forbiddenActions: readonly string[]
}

const PROFILES: Record<string, Omit<SubagentGovernanceProfile, 'id'>> = {
  aurora: { division: 'Creation & Design', class: 'creation', reportsTo: 'vid', mission: 'Lead content and affiliate strategy while delegating production to specialists.', riskLevel: 'medium', verificationTier: 'enhanced', providerOrder: PROVIDER_PRIORITY, taskTypes: ['creative', 'research', 'analysis'], mustEscalateFor: ['financial commitments', 'legal interpretation', 'production code changes'], forbiddenActions: ['deploying production changes directly'] },
  vertex: { division: 'Product & Engineering', class: 'product-engineering', reportsTo: 'vid', mission: 'Design viable products and technical architectures.', riskLevel: 'medium', verificationTier: 'enhanced', providerOrder: PROVIDER_PRIORITY, taskTypes: ['reasoning', 'coding', 'analysis', 'research'], mustEscalateFor: ['security-sensitive architecture', 'financial execution'], forbiddenActions: ['autonomous production deployment'] },
  quantum: { division: 'Finance & Markets', class: 'revenue-market', reportsTo: 'vid', mission: 'Analyze investments and yield opportunities using evidence and risk controls.', riskLevel: 'high', verificationTier: 'dual-review', providerOrder: PROVIDER_PRIORITY, taskTypes: ['financial', 'analysis', 'research'], mustEscalateFor: ['capital allocation', 'trade execution', 'regulated advice'], forbiddenActions: ['executing financial transactions without governance approval'] },
  scout: { division: 'Intelligence', class: 'intelligence', reportsTo: 'vid', mission: 'Discover trends, markets, competitors, and evidence-backed opportunities.', riskLevel: 'medium', verificationTier: 'enhanced', providerOrder: PROVIDER_PRIORITY, taskTypes: ['research', 'analysis'], mustEscalateFor: ['high-impact financial or legal conclusions'], forbiddenActions: ['treating a single source as authoritative for high-risk decisions'] },
  hunt: { division: 'Revenue & Market', class: 'revenue-market', reportsTo: 'vid', mission: 'Discover legitimate freelance and marketplace opportunities.', riskLevel: 'medium', verificationTier: 'enhanced', providerOrder: PROVIDER_PRIORITY, taskTypes: ['research', 'analysis', 'creative'], mustEscalateFor: ['external account actions'], forbiddenActions: ['automating marketplace actions outside approved scopes'] },
  forge: { division: 'Product & Engineering', class: 'product-engineering', reportsTo: 'vid', mission: 'Build technical solutions and automation under repository governance.', riskLevel: 'high', verificationTier: 'strict', providerOrder: PROVIDER_PRIORITY, taskTypes: ['coding', 'reasoning'], mustEscalateFor: ['production changes', 'security-sensitive code'], forbiddenActions: ['direct production deployment', 'bypassing CI'] },
  quill: { division: 'Creation & Design', class: 'creation', reportsTo: 'aurora', mission: 'Produce high-quality written content from approved strategy.', riskLevel: 'low', verificationTier: 'standard', providerOrder: PROVIDER_PRIORITY, taskTypes: ['creative'], mustEscalateFor: ['legal claims', 'high-risk financial claims'], forbiddenActions: ['publishing regulated claims without review'] },
  prism: { division: 'Creation & Design', class: 'creation', reportsTo: 'aurora', mission: 'Produce visual assets aligned with brand and accessibility requirements.', riskLevel: 'low', verificationTier: 'standard', providerOrder: PROVIDER_PRIORITY, taskTypes: ['creative'], mustEscalateFor: ['copyright or licensing concerns'], forbiddenActions: ['publishing assets with unresolved rights issues'] },
  pulse: { division: 'Analytics & Optimization', class: 'analytics-optimization', reportsTo: 'vid', mission: 'Measure performance and surface validated KPI changes.', riskLevel: 'medium', verificationTier: 'enhanced', providerOrder: PROVIDER_PRIORITY, taskTypes: ['analysis', 'reasoning'], mustEscalateFor: ['causal claims without evidence'], forbiddenActions: ['treating correlation as causation'] },
  echo: { division: 'Analytics & Optimization', class: 'analytics-optimization', reportsTo: 'vid', mission: 'Convert measured outcomes into validated learning and optimization proposals.', riskLevel: 'medium', verificationTier: 'enhanced', providerOrder: PROVIDER_PRIORITY, taskTypes: ['analysis', 'research', 'reasoning'], mustEscalateFor: ['experiments affecting material revenue or users'], forbiddenActions: ['optimizing without guardrail metrics'] },
  legal: { division: 'Governance', class: 'governance', reportsTo: 'vid', mission: 'Provide evidence-based legal and tax research with jurisdiction and date awareness.', riskLevel: 'critical', verificationTier: 'dual-review', providerOrder: PROVIDER_PRIORITY, taskTypes: ['research', 'analysis', 'reasoning'], mustEscalateFor: ['legal opinions', 'tax filing decisions', 'regulated actions'], forbiddenActions: ['presenting model output as legal advice without authoritative sourcing'] },
  banker: { division: 'Finance & Markets', class: 'revenue-market', reportsTo: 'vid', mission: 'Manage banking and treasury analysis without autonomous capital movement.', riskLevel: 'critical', verificationTier: 'dual-review', providerOrder: PROVIDER_PRIORITY, taskTypes: ['financial', 'analysis', 'research'], mustEscalateFor: ['transfers', 'credit decisions', 'regulated banking actions'], forbiddenActions: ['initiating funds movement autonomously'] },
  trader: { division: 'Finance & Markets', class: 'revenue-market', reportsTo: 'vid', mission: 'Analyze trading opportunities under strict risk and approval controls.', riskLevel: 'critical', verificationTier: 'dual-review', providerOrder: PROVIDER_PRIORITY, taskTypes: ['financial', 'analysis'], mustEscalateFor: ['trade execution', 'capital allocation'], forbiddenActions: ['autonomous trade execution without explicit authorization'] },
  cybersecurity_a: { division: 'Security', class: 'security', reportsTo: 'vid', mission: 'Perform authorized offensive security assessments against approved targets.', riskLevel: 'critical', verificationTier: 'strict', providerOrder: PROVIDER_PRIORITY, taskTypes: ['security', 'analysis'], mustEscalateFor: ['out-of-scope testing'], forbiddenActions: ['testing unapproved external targets'] },
  cybersecurity_r: { division: 'Security', class: 'security', reportsTo: 'vid', mission: 'Contain, harden, and verify remediation of security incidents.', riskLevel: 'critical', verificationTier: 'strict', providerOrder: PROVIDER_PRIORITY, taskTypes: ['security', 'analysis', 'reasoning'], mustEscalateFor: ['irreversible containment actions'], forbiddenActions: ['destroying evidence'] },
  developer: { division: 'Product & Engineering', class: 'product-engineering', reportsTo: 'forge', mission: 'Repair and harden existing code under governed change control.', riskLevel: 'high', verificationTier: 'strict', providerOrder: PROVIDER_PRIORITY, taskTypes: ['coding', 'reasoning'], mustEscalateFor: ['production changes', 'schema-destructive changes'], forbiddenActions: ['bypassing CI or change review'] },
  qa_monitor: { division: 'Operations & Reliability', class: 'operations', reportsTo: 'vid', mission: 'Monitor internal application health and route anomalies for remediation.', riskLevel: 'medium', verificationTier: 'enhanced', providerOrder: PROVIDER_PRIORITY, taskTypes: ['operations', 'analysis'], mustEscalateFor: ['critical outages'], forbiddenActions: ['claiming external availability from internal checks alone'] },
  external_uptime_monitor: { division: 'Operations & Reliability', class: 'operations', reportsTo: 'vid', mission: 'Monitor outside-in availability, DNS, SSL, and third-party connectivity.', riskLevel: 'medium', verificationTier: 'enhanced', providerOrder: PROVIDER_PRIORITY, taskTypes: ['operations', 'analysis'], mustEscalateFor: ['persistent external outage'], forbiddenActions: ['modifying external systems without explicit scope'] },
  vid: { division: 'Executive Office', class: 'director', reportsTo: 'ceo', mission: 'Direct venture intelligence, portfolio strategy, and knowledge transfer across the organization.', riskLevel: 'high', verificationTier: 'dual-review', providerOrder: PROVIDER_PRIORITY, taskTypes: ['reasoning', 'research', 'analysis', 'financial'], mustEscalateFor: ['material capital allocation', 'legal decisions', 'production changes'], forbiddenActions: ['overriding the CEO or governance policies'] },
}

export function getSubagentGovernanceProfile(id: string): SubagentGovernanceProfile | undefined {
  const profile = PROFILES[id]
  return profile ? { id, ...profile } : undefined
}

export function getAllGovernanceProfiles(): SubagentGovernanceProfile[] {
  return Object.entries(PROFILES).map(([id, profile]) => ({ id, ...profile }))
}

export function validateBuiltinGovernanceCoverage(subagents: Subagent[]): string[] {
  const builtins = subagents.filter((agent) => agent.isBuiltin !== false)
  const ids = builtins.map((agent) => agent.id)
  const errors: string[] = []
  if (new Set(ids).size !== ids.length) errors.push('Duplicate built-in subagent IDs detected')
  for (const id of ids) if (!PROFILES[id]) errors.push(`Missing governance profile for built-in subagent: ${id}`)
  for (const id of Object.keys(PROFILES)) if (!ids.includes(id)) errors.push(`Governance profile has no built-in subagent: ${id}`)
  return errors
}

export const DEFAULT_PROVIDER_ORDER: readonly ProviderId[] = PROVIDER_PRIORITY