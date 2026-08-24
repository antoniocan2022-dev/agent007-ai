export type OrganizationLevel = 'CEO' | 'VID' | 'LEADER' | 'SPECIALIST'

export interface CommercialNode {
  id: string
  title: string
  division: string
  mission: string
  level: OrganizationLevel
  reportsTo: string | null
  businesses: readonly string[]
}

export type CommercialLeader = CommercialNode

export const COMMERCIAL_LEADERS: readonly CommercialLeader[] = [
  { id: 'ceo', title: 'Chief Executive Officer', division: 'Executive Office', mission: 'Set enterprise direction, approve strategic ownership actions, and govern the operating organization.', level: 'CEO', reportsTo: null, businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'vid', title: 'Venture Intelligence Director', division: 'Executive Office', mission: 'Allocate resources across the commercial portfolio under the CEO mandate.', level: 'VID', reportsTo: 'ceo', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'revenue_recovery_leader', title: 'Revenue Recovery Business Leader', division: 'Revenue Recovery', mission: 'Turn local-business revenue leakage into verified recovered revenue and recurring customer value.', level: 'LEADER', reportsTo: 'vid', businesses: ['revenue-recovery'] },
  { id: 'operations_kit_leader', title: 'SMB Operations Business Leader', division: 'SMB Operations', mission: 'Turn messy small-business processes into measurable, reusable, automatable operating workflows.', level: 'LEADER', reportsTo: 'vid', businesses: ['operations-kit'] },
  { id: 'career_command_leader', title: 'Career Command Business Leader', division: 'Career Command', mission: 'Convert career goals into prioritized opportunities, applications, interviews, and measurable career outcomes.', level: 'LEADER', reportsTo: 'vid', businesses: ['career-command'] },
  { id: 'scout', title: 'Intelligence Leader', division: 'Intelligence', mission: 'Provide verified market, customer, competitor, and source intelligence across the commercial portfolio.', level: 'LEADER', reportsTo: 'vid', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'vertex', title: 'Product Leader', division: 'Product & Engineering', mission: 'Own product architecture, integration boundaries, reusable commercial capabilities, and platform quality.', level: 'LEADER', reportsTo: 'vid', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'forge', title: 'Engineering & Commercial Execution Leader', division: 'Product & Engineering', mission: 'Own provider adapters, external action execution, durable automation, reliability, and production integration quality.', level: 'LEADER', reportsTo: 'vertex', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'aurora', title: 'Growth & Content Leader', division: 'Growth & GTM', mission: 'Acquire qualified prospects and communicate verified customer value without fabricated claims.', level: 'LEADER', reportsTo: 'vid', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'quantum', title: 'Finance & Revenue Operations Leader', division: 'Finance & Markets', mission: 'Protect unit economics, billing integrity, pricing discipline, and portfolio capital efficiency.', level: 'LEADER', reportsTo: 'vid', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'pulse', title: 'Analytics Leader', division: 'Analytics & Optimization', mission: 'Measure commercial funnels and business health from observed events.', level: 'LEADER', reportsTo: 'vid', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'echo', title: 'Experimentation & Learning Leader', division: 'Analytics & Optimization', mission: 'Turn experiments and outcomes into validated organizational learning.', level: 'LEADER', reportsTo: 'vid', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'legal', title: 'Legal & Compliance Leader', division: 'Legal & Compliance', mission: 'Govern legal, compliance, and contractual risk across the commercial portfolio.', level: 'LEADER', reportsTo: 'vid', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'banker', title: 'Banking & Capital Leader', division: 'Finance & Markets', mission: 'Coordinate banking, treasury, and capital-control capabilities across the portfolio.', level: 'LEADER', reportsTo: 'vid', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'hunt', title: 'Opportunity & Acquisition Leader', division: 'Sales & Acquisition', mission: 'Identify and qualify external opportunities and acquisition paths.', level: 'LEADER', reportsTo: 'vid', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'cybersecurity_a', title: 'Cybersecurity Assurance Leader', division: 'Security & Governance', mission: 'Protect enterprise and venture security posture through assurance controls.', level: 'LEADER', reportsTo: 'vid', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'cybersecurity_r', title: 'Cybersecurity Response Leader', division: 'Security & Governance', mission: 'Coordinate security response, containment, and recovery.', level: 'LEADER', reportsTo: 'vid', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'trader', title: 'Market & Trading Leader', division: 'Finance & Markets', mission: 'Govern market intelligence and trading-oriented analytical capabilities.', level: 'LEADER', reportsTo: 'vid', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'revenue', title: 'Revenue Leader', division: 'Revenue & Growth', mission: 'Optimize recurring revenue, monetization, and portfolio growth.', level: 'LEADER', reportsTo: 'vid', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'external_uptime_monitor', title: 'External Uptime Monitor Leader', division: 'Reliability & Governance', mission: 'Protect external availability and operational continuity.', level: 'LEADER', reportsTo: 'vid', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'qa_monitor', title: 'Quality Assurance Monitor Leader', division: 'Quality & Governance', mission: 'Continuously validate system quality and release integrity.', level: 'LEADER', reportsTo: 'vid', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
] as const

export const COMMERCIAL_SPECIALISTS: readonly CommercialNode[] = [
  { id: 'local_business_intelligence', title: 'Local Business Intelligence Specialist', division: 'Revenue Recovery', mission: 'Discover local-business commercial intelligence.', level: 'SPECIALIST', reportsTo: 'revenue_recovery_leader', businesses: ['revenue-recovery'] },
  { id: 'revenue_leakage_analyst', title: 'Revenue Leakage Analyst', division: 'Revenue Recovery', mission: 'Analyze leakage and recovery opportunities.', level: 'SPECIALIST', reportsTo: 'revenue_recovery_leader', businesses: ['revenue-recovery'] },
  { id: 'lead_crm_specialist', title: 'Lead CRM Specialist', division: 'Revenue Recovery', mission: 'Manage lead qualification and CRM lifecycle controls.', level: 'SPECIALIST', reportsTo: 'revenue_recovery_leader', businesses: ['revenue-recovery'] },
  { id: 'conversion_specialist', title: 'Conversion Specialist', division: 'Revenue Recovery', mission: 'Improve qualified lead-to-customer conversion.', level: 'SPECIALIST', reportsTo: 'revenue_recovery_leader', businesses: ['revenue-recovery'] },
  { id: 'customer_success_specialist', title: 'Customer Success Specialist', division: 'Revenue Recovery', mission: 'Drive verified customer adoption and retention.', level: 'SPECIALIST', reportsTo: 'revenue_recovery_leader', businesses: ['revenue-recovery'] },
  { id: 'process_discovery', title: 'Process Discovery Specialist', division: 'SMB Operations', mission: 'Identify operational bottlenecks and workflow opportunities.', level: 'SPECIALIST', reportsTo: 'operations_kit_leader', businesses: ['operations-kit'] },
  { id: 'sop_architect', title: 'SOP Architect', division: 'SMB Operations', mission: 'Design reusable standard operating procedures.', level: 'SPECIALIST', reportsTo: 'operations_kit_leader', businesses: ['operations-kit'] },
  { id: 'workflow_automation', title: 'Workflow Automation Specialist', division: 'SMB Operations', mission: 'Translate operating processes into governed automation.', level: 'SPECIALIST', reportsTo: 'operations_kit_leader', businesses: ['operations-kit'] },
  { id: 'kpi_controller', title: 'KPI Controller', division: 'SMB Operations', mission: 'Maintain operational measurement discipline.', level: 'SPECIALIST', reportsTo: 'operations_kit_leader', businesses: ['operations-kit'] },
  { id: 'operations_customer_success', title: 'Operations Customer Success Specialist', division: 'SMB Operations', mission: 'Support customer adoption of operating workflows.', level: 'SPECIALIST', reportsTo: 'operations_kit_leader', businesses: ['operations-kit'] },
  { id: 'job_intelligence', title: 'Job Intelligence Specialist', division: 'Career Command', mission: 'Source verified career opportunities.', level: 'SPECIALIST', reportsTo: 'career_command_leader', businesses: ['career-command'] },
  { id: 'job_matching', title: 'Job Matching Specialist', division: 'Career Command', mission: 'Match opportunities to candidate goals and qualifications.', level: 'SPECIALIST', reportsTo: 'career_command_leader', businesses: ['career-command'] },
  { id: 'resume_engineer', title: 'Resume Engineering Specialist', division: 'Career Command', mission: 'Optimize evidence-based resumes for target opportunities.', level: 'SPECIALIST', reportsTo: 'career_command_leader', businesses: ['career-command'] },
  { id: 'application_specialist', title: 'Application Specialist', division: 'Career Command', mission: 'Coordinate accurate application execution.', level: 'SPECIALIST', reportsTo: 'career_command_leader', businesses: ['career-command'] },
  { id: 'interview_coach', title: 'Interview Coach', division: 'Career Command', mission: 'Prepare candidates for evidence-based interviews.', level: 'SPECIALIST', reportsTo: 'career_command_leader', businesses: ['career-command'] },
  { id: 'market_research', title: 'Market Research Specialist', division: 'Intelligence', mission: 'Research market conditions and demand.', level: 'SPECIALIST', reportsTo: 'scout', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'competitive_intelligence', title: 'Competitive Intelligence Specialist', division: 'Intelligence', mission: 'Monitor competitors and market alternatives.', level: 'SPECIALIST', reportsTo: 'scout', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'data_enrichment', title: 'Data Enrichment Specialist', division: 'Intelligence', mission: 'Enrich validated business and customer intelligence.', level: 'SPECIALIST', reportsTo: 'scout', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'integration_engineer', title: 'Integration Engineer', division: 'Product & Engineering', mission: 'Build and maintain governed external integrations.', level: 'SPECIALIST', reportsTo: 'forge', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'automation_engineer', title: 'Automation Engineer', division: 'Product & Engineering', mission: 'Build durable, observable automation.', level: 'SPECIALIST', reportsTo: 'forge', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'credential_lifecycle_specialist', title: 'Credential Lifecycle Specialist', division: 'Product & Engineering', mission: 'Govern credential lifecycle and secure integration access.', level: 'SPECIALIST', reportsTo: 'forge', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'webhook_reliability_specialist', title: 'Webhook Reliability Specialist', division: 'Product & Engineering', mission: 'Maintain webhook delivery and replay integrity.', level: 'SPECIALIST', reportsTo: 'forge', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'execution_reliability_specialist', title: 'Execution Reliability Specialist', division: 'Product & Engineering', mission: 'Protect durable execution and recovery behavior.', level: 'SPECIALIST', reportsTo: 'forge', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'provider_observability_specialist', title: 'Provider Observability Specialist', division: 'Product & Engineering', mission: 'Measure provider health and runtime reliability.', level: 'SPECIALIST', reportsTo: 'forge', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'external_action_governance_specialist', title: 'External Action Governance Specialist', division: 'Product & Engineering', mission: 'Govern irreversible external actions.', level: 'SPECIALIST', reportsTo: 'forge', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'quill', title: 'Content Specialist', division: 'Growth & GTM', mission: 'Produce governed growth content.', level: 'SPECIALIST', reportsTo: 'aurora', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'prism', title: 'Growth Messaging Specialist', division: 'Growth & GTM', mission: 'Develop verified growth messaging and offers.', level: 'SPECIALIST', reportsTo: 'aurora', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'seo_cro_specialist', title: 'SEO/CRO Specialist', division: 'Growth & GTM', mission: 'Optimize discoverability and conversion.', level: 'SPECIALIST', reportsTo: 'aurora', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'unit_economics', title: 'Unit Economics Specialist', division: 'Finance & Markets', mission: 'Protect unit-economic quality and capital efficiency.', level: 'SPECIALIST', reportsTo: 'quantum', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'billing_reconciliation', title: 'Billing Reconciliation Specialist', division: 'Finance & Markets', mission: 'Reconcile billing and transaction evidence.', level: 'SPECIALIST', reportsTo: 'quantum', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'attribution_analyst', title: 'Attribution Analyst', division: 'Analytics & Optimization', mission: 'Measure observed commercial attribution.', level: 'SPECIALIST', reportsTo: 'pulse', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'cohort_analyst', title: 'Cohort Analyst', division: 'Analytics & Optimization', mission: 'Measure cohort health and retention.', level: 'SPECIALIST', reportsTo: 'pulse', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'experiment_manager', title: 'Experiment Manager', division: 'Analytics & Optimization', mission: 'Operate controlled experiments and measure outcomes.', level: 'SPECIALIST', reportsTo: 'echo', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'learning_curator', title: 'Learning Curator', division: 'Analytics & Optimization', mission: 'Convert verified outcomes into reusable organizational learning.', level: 'SPECIALIST', reportsTo: 'echo', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'developer', title: 'Development Specialist', division: 'Product & Engineering', mission: 'Implement governed technical changes under engineering leadership.', level: 'SPECIALIST', reportsTo: 'forge', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
] as const

export const COMMERCIAL_ORGANIZATION: readonly CommercialNode[] = [...COMMERCIAL_LEADERS, ...COMMERCIAL_SPECIALISTS]

const normalizeId = (value: string) => value.trim().toLowerCase().replace(/\s+/g, '_')
const nodeById = new Map(COMMERCIAL_ORGANIZATION.map((node) => [normalizeId(node.id), node]))

export function getCommercialNode(id: string): CommercialNode | null {
  const normalized = normalizeId(id)
  return normalized ? nodeById.get(normalized) ?? null : null
}

export function directReportsOf(leaderId: string): string[] {
  const normalized = normalizeId(leaderId)
  if (!normalized) return []
  return COMMERCIAL_ORGANIZATION.filter((node) => node.reportsTo === normalized).map((node) => node.id)
}

export function allDescendantsOf(leaderId: string): string[] {
  const queue = directReportsOf(leaderId)
  const descendants: string[] = []
  while (queue.length) {
    const id = queue.shift() as string
    descendants.push(id)
    queue.push(...directReportsOf(id))
  }
  return descendants
}

export function ancestorsOf(id: string): string[] {
  const ancestors: string[] = []
  let current = getCommercialNode(id)
  while (current?.reportsTo) {
    ancestors.push(current.reportsTo)
    current = getCommercialNode(current.reportsTo)
  }
  return ancestors
}

export function businessScopeFor(id: string): readonly string[] {
  return getCommercialNode(id)?.businesses ?? []
}

export function leadersForBusiness(businessId: string): CommercialLeader[] {
  const normalized = normalizeId(businessId)
  if (!normalized) return []
  return COMMERCIAL_LEADERS.filter((node) => node.level === 'LEADER' && node.businesses.includes(normalized))
}

export function specialistsForBusiness(businessId: string): CommercialNode[] {
  const normalized = normalizeId(businessId)
  if (!normalized) return []
  return COMMERCIAL_SPECIALISTS.filter((node) => node.businesses.includes(normalized))
}

export function supportsBusiness(id: string, businessId: string): boolean {
  const normalizedBusiness = normalizeId(businessId)
  return normalizedBusiness.length > 0 && businessScopeFor(id).includes(normalizedBusiness)
}

export function commercialBusinessIds(): string[] {
  return [...new Set(COMMERCIAL_ORGANIZATION.flatMap((node) => node.businesses.map(normalizeId)).filter(Boolean))].sort()
}

export function validateCommercialOrganization(): string[] {
  const errors: string[] = []
  const ids = COMMERCIAL_ORGANIZATION.map((node) => normalizeId(node.id))
  const uniqueIds = new Set(ids)
  if (uniqueIds.size !== ids.length) errors.push('Commercial organization IDs are duplicated.')
  if (!nodeById.has('ceo')) errors.push('Commercial organization must contain the CEO node.')
  if (getCommercialNode('ceo')?.reportsTo !== null) errors.push('CEO must be the organization root.')

  for (const node of COMMERCIAL_ORGANIZATION) {
    const normalizedId = normalizeId(node.id)
    const parentId = node.reportsTo ? normalizeId(node.reportsTo) : null
    const businesses = node.businesses.map(normalizeId)
    if (!node.title.trim()) errors.push(`Organization node ${normalizedId} has no title.`)
    if (!node.division.trim()) errors.push(`Organization node ${normalizedId} has no division.`)
    if (!node.mission.trim()) errors.push(`Organization node ${normalizedId} has no mission.`)
    if (new Set(businesses).size !== businesses.length) errors.push(`Organization node ${normalizedId} has duplicate business scopes.`)
    if (businesses.length === 0) errors.push(`Organization node ${normalizedId} has no business scope.`)
    if (parentId && !nodeById.has(parentId)) errors.push(`Organization node ${normalizedId} reports to unknown node ${parentId}.`)
    if (node.level === 'CEO' && node.id !== 'ceo') errors.push(`Only ceo may have CEO authority; found ${normalizedId}.`)
    if (node.level === 'VID' && parentId !== 'ceo') errors.push(`VID node ${normalizedId} must report to ceo.`)
    if (node.level === 'LEADER' && (!parentId || getCommercialNode(parentId)?.level === 'SPECIALIST')) errors.push(`Leader ${normalizedId} must report to CEO/VID/another leader.`)
    if (node.level === 'SPECIALIST' && getCommercialNode(parentId ?? '')?.level !== 'LEADER') errors.push(`Specialist ${normalizedId} must report to a leader.`)
  }

  for (const node of COMMERCIAL_ORGANIZATION) {
    const seen = new Set<string>()
    let current = node
    while (current.reportsTo) {
      const parentId = normalizeId(current.reportsTo)
      if (seen.has(parentId)) { errors.push(`Organization hierarchy contains a cycle involving ${node.id}.`); break }
      seen.add(parentId)
      const parent = getCommercialNode(parentId)
      if (!parent) break
      current = parent
    }
  }

  const businesses = commercialBusinessIds()
  for (const business of businesses) {
    if (leadersForBusiness(business).length === 0) errors.push(`Business ${business} has no commercial leader.`)
  }
  return [...new Set(errors)]
}

export function validateCommercialLeaders(): string[] {
  return validateCommercialOrganization()
}
