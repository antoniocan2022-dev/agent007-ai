export interface CommercialLeader {
  id: string
  title: string
  division: string
  mission: string
  reportsTo: string
  directReports: string[]
  businesses: string[]
}

export const COMMERCIAL_LEADERS: readonly CommercialLeader[] = [
  { id: 'vid', title: 'Venture Intelligence Director', division: 'Executive Office', mission: 'Allocate resources across the three ventures under the CEO Venture Mandate.', reportsTo: 'ceo', directReports: ['revenue_recovery_leader', 'operations_kit_leader', 'career_command_leader'], businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'revenue_recovery_leader', title: 'Revenue Recovery Business Leader', division: 'Revenue Recovery', mission: 'Turn local-business revenue leakage into verified recovered revenue and recurring customer value.', reportsTo: 'vid', directReports: ['local_business_intelligence', 'revenue_leakage_analyst', 'lead_crm_specialist', 'conversion_specialist', 'customer_success_specialist'], businesses: ['revenue-recovery'] },
  { id: 'operations_kit_leader', title: 'SMB Operations Business Leader', division: 'SMB Operations', mission: 'Turn messy small-business processes into measurable, reusable, automatable operating workflows.', reportsTo: 'vid', directReports: ['process_discovery', 'sop_architect', 'workflow_automation', 'kpi_controller', 'operations_customer_success'], businesses: ['operations-kit'] },
  { id: 'career_command_leader', title: 'Career Command Business Leader', division: 'Career Command', mission: 'Convert career goals into prioritized opportunities, applications, interviews, and measurable career outcomes.', reportsTo: 'vid', directReports: ['job_intelligence', 'job_matching', 'resume_engineer', 'application_specialist', 'interview_coach'], businesses: ['career-command'] },
  { id: 'scout', title: 'Intelligence Leader', division: 'Intelligence', mission: 'Provide verified market, customer, competitor, and source intelligence to all three businesses.', reportsTo: 'vid', directReports: ['market_research', 'competitive_intelligence', 'data_enrichment'], businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'vertex', title: 'Product Leader', division: 'Product & Engineering', mission: 'Own product architecture, integration boundaries, reusable commercial capabilities, and platform quality.', reportsTo: 'vid', directReports: ['forge'], businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'forge', title: 'Engineering & Commercial Execution Leader', division: 'Product & Engineering', mission: 'Own Phase 6 provider adapters, external action execution, durable automation, reliability, and production integration quality.', reportsTo: 'vertex', directReports: ['integration_engineer', 'automation_engineer', 'credential_lifecycle_specialist', 'webhook_reliability_specialist', 'execution_reliability_specialist', 'provider_observability_specialist', 'external_action_governance_specialist'], businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'aurora', title: 'Growth & Content Leader', division: 'Growth & GTM', mission: 'Acquire qualified prospects and communicate verified customer value without fabricated claims.', reportsTo: 'vid', directReports: ['quill', 'prism', 'seo_cro_specialist'], businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'quantum', title: 'Finance & Revenue Operations Leader', division: 'Finance & Markets', mission: 'Protect unit economics, billing integrity, pricing discipline, and portfolio capital efficiency.', reportsTo: 'vid', directReports: ['unit_economics', 'billing_reconciliation'], businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'pulse', title: 'Analytics Leader', division: 'Analytics & Optimization', mission: 'Measure commercial funnels and business health from observed events.', reportsTo: 'vid', directReports: ['attribution_analyst', 'cohort_analyst'], businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'echo', title: 'Experimentation & Learning Leader', division: 'Analytics & Optimization', mission: 'Turn experiments and outcomes into validated organizational learning.', reportsTo: 'vid', directReports: ['experiment_manager', 'learning_curator'], businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
]

export function validateCommercialLeaders(): string[] {
  const errors: string[] = []
  const ids = COMMERCIAL_LEADERS.map((leader) => leader.id)
  if (new Set(ids).size !== ids.length) errors.push('Commercial leader IDs are duplicated.')
  const leaders = new Set(ids)
  for (const leader of COMMERCIAL_LEADERS) if (leader.id !== 'vid' && !leaders.has(leader.reportsTo)) errors.push(`Leader ${leader.id} reports to unknown leader ${leader.reportsTo}.`)
  for (const leader of COMMERCIAL_LEADERS) if (new Set(leader.directReports).size !== leader.directReports.length) errors.push(`Leader ${leader.id} has duplicate direct reports.`)
  return errors
}
