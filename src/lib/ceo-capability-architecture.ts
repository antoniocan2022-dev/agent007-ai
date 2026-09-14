import type { CeoExecutionContract, EvidenceDomain, EvidenceOperation } from './ceo-cognitive-contract'

export type CapabilityDomain = 'research' | 'finance' | 'market_intelligence' | 'communication' | 'commerce' | 'crm' | 'documents' | 'calendar' | 'email' | 'github' | 'cloud' | 'monitoring' | 'analytics' | 'security' | 'operations'
export interface FunctionDescriptor { id: string; description: string }
export interface ToolDescriptor { id: string; description: string; reliability: number; freshness: number; latencyMs: number; cost: number; risk: number; permissions: string[]; functions: FunctionDescriptor[] }
export interface ServiceDescriptor { id: string; description: string; tools: ToolDescriptor[] }
export interface CapabilityDescriptor { id: string; domain: CapabilityDomain; description: string; services: ServiceDescriptor[] }
export interface EnterpriseCapability { id: CapabilityDomain; description: string; capabilities: CapabilityDescriptor[] }

const capability = (domain: CapabilityDomain, id: string, description: string, tools: ToolDescriptor[] = []): CapabilityDescriptor => ({ id, domain, description, services: [{ id: `${id}.service`, description: `${description} service`, tools }] })
const tool = (id: string, description: string, reliability = 0.8, freshness = 0.8, latencyMs = 5000, cost = 0, risk = 0.2, permissions: string[] = []): ToolDescriptor => ({ id, description, reliability, freshness, latencyMs, cost, risk, permissions, functions: [{ id: `${id}.execute`, description }] })

// Deep-audit fix: this catalog was designed to cover the whole tool registry (it has fields for
// permissions/risk/cost/reliability on every entry, and an enterprise-capability taxonomy
// spanning finance, commerce, email, cloud, security) but every domain except research/
// market_intelligence had an empty tools array -- so selectCeoTool() (ceo-tool-selection.ts)
// could structurally never choose anything but web_search/page_reader, no matter the task.
// Populated with the tools this codebase's own web/finance audits confirmed are genuinely real
// (live network calls, honest credential-gated failure, never fabricated data) -- not the tools
// that were found to fabricate results (the pre-fix ai-search-engines.ts family, the fabricated
// payment/payout/banking tool cluster). Reliability/freshness/cost/risk are deliberately
// conservative estimates, not measured telemetry -- selectCeoTool blends them with observed
// reliability from actual usage, so a wrong guess here self-corrects over time rather than
// permanently mis-ranking a tool.
export const CEO_CAPABILITY_ARCHITECTURE: readonly EnterpriseCapability[] = Object.freeze([
  { id: 'research', description: 'General external and internal research', capabilities: [capability('research', 'research.general', 'Research and source acquisition', [
    tool('web_search', 'Search external sources (always available, no key required)', 0.82, 0.95, 6500),
    tool('page_reader', 'Read an identified source', 0.9, 0.92, 5000),
    tool('tavily_search', 'AI-optimized search with cited results (credential-gated)', 0.88, 0.95, 4000, 0, 0.15),
    tool('exa_search', 'Neural/semantic search, finds conceptually similar content (credential-gated)', 0.85, 0.9, 4500, 0, 0.15),
    tool('serpapi', 'Structured Google results (credential-gated)', 0.85, 0.93, 4000, 0, 0.15),
    tool('perplexity_ai_search', 'Cited, real-time synthesized answer (credential-gated, honestly delegates to a real search engine otherwise)', 0.8, 0.93, 6000, 0, 0.15),
    tool('jina_reader', 'Read any URL as clean markdown (free, no key required)', 0.8, 0.88, 5000),
    tool('kb_search', 'Search the owner\'s ingested knowledge base (documents, transcripts)', 0.85, 0.7, 3000),
    tool('multi_search_compare', 'Cross-verify a query across multiple real engines at once, detect disagreement', 0.85, 0.93, 12000, 0, 0.15),
  ])] },
  { id: 'finance', description: 'Financial analysis and internal finance operations', capabilities: [capability('finance', 'finance.analysis', 'Analyze financial information', [
    tool('yahoo_finance', 'Live stock/ETF/index quotes (free, no key required)', 0.85, 0.95, 3000),
    tool('coingecko', 'Live crypto prices and market data (free, no key required)', 0.85, 0.95, 3000),
    tool('finnhub_quote', 'Real-time-ish stock quotes, generous free tier (credential-gated)', 0.85, 0.95, 3000, 0, 0.15),
    tool('alpha_vantage', 'Stock/forex/crypto quotes, thin free tier (credential-gated)', 0.8, 0.9, 4000, 0, 0.15),
    tool('fred_economic', 'Official US Federal Reserve macroeconomic data series (credential-gated, unlimited free)', 0.9, 0.85, 4000, 0, 0.1),
    tool('financial_tracker', 'Real income/expense summary from this venture\'s own recorded transactions', 0.9, 0.8, 3000),
    tool('payment_processor', 'Real status of configured payment gateways and recorded transaction volume', 0.9, 0.85, 3000),
  ])] },
  { id: 'market_intelligence', description: 'Market, competitor and industry intelligence', capabilities: [capability('market_intelligence', 'market.competitive', 'Competitive and market intelligence', [
    tool('web_search', 'Acquire current market intelligence', 0.82, 0.95, 6500),
    tool('newsapi', 'Real-time news search across 80,000+ sources (credential-gated)', 0.82, 0.95, 4000, 0, 0.15),
    tool('tavily_search', 'AI-optimized search with cited results (credential-gated)', 0.88, 0.95, 4000, 0, 0.15),
  ])] },
  { id: 'communication', description: 'Communications and external messaging', capabilities: [capability('communication', 'communication.messaging', 'Create and send governed communications')] },
  { id: 'commerce', description: 'Commerce, orders and transactions', capabilities: [capability('commerce', 'commerce.execution', 'Governed commerce operations', [
    tool('stripe_payment_processor', 'Real Stripe payment intents (credential-gated)', 0.85, 0.9, 5000, 0, 0.4),
    tool('paypal_api', 'Real PayPal balance/orders/payouts (credential-gated, defaults to sandbox)', 0.85, 0.9, 5000, 0, 0.4),
  ])] },
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
  if (domain === 'internal_operations') return 'operations'
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

// Fresh-audit fix: ceo-tool-selection.ts used to guess a capability's id from its domain by
// hardcoding the two suffix patterns that happen to exist ("market.competitive" for
// market_intelligence, "research.general" for research) -- every other domain's real id
// (finance.analysis, commerce.execution, communication.messaging, etc.) never matched either
// guessed suffix, so selectCeoTool() silently found zero candidates and fell back to web_search
// for finance/commerce/every other populated domain, no matter what tools this file lists for
// them. Each enterprise's own id already equals its CapabilityDomain, so look it up directly.
export function findCapabilityForDomain(domain: CapabilityDomain): CapabilityDescriptor | undefined {
  return CEO_CAPABILITY_ARCHITECTURE.find((enterprise) => enterprise.id === domain)?.capabilities[0]
}

export function capabilityNeedFromDecision(contract: CeoExecutionContract): { domain: CapabilityDomain; operation: EvidenceOperation; capabilities: string[] } {
  return { domain: capabilityForDomain(contract.domain), operation: contract.operation, capabilities: capabilitiesForDecision(contract) }
}