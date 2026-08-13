export interface CommercialSpecialist {
  id: string
  title: string
  division: string
  reportsTo: string
  mission: string
  businesses: string[]
}

export const COMMERCIAL_SPECIALISTS: readonly CommercialSpecialist[] = [
  { id: 'local_business_intelligence', title: 'Local Business Intelligence', division: 'Revenue Recovery', reportsTo: 'revenue_recovery_leader', mission: 'Profile target local businesses and detect verified market signals.', businesses: ['revenue-recovery'] },
  { id: 'revenue_leakage_analyst', title: 'Revenue Leakage Analyst', division: 'Revenue Recovery', reportsTo: 'revenue_recovery_leader', mission: 'Quantify missed leads, conversion loss, no-shows, and recoverable revenue.', businesses: ['revenue-recovery'] },
  { id: 'lead_crm_specialist', title: 'Lead & CRM Specialist', division: 'Revenue Recovery', reportsTo: 'revenue_recovery_leader', mission: 'Maintain lead state, follow-up queues, customer history, and pipeline evidence.', businesses: ['revenue-recovery'] },
  { id: 'conversion_specialist', title: 'Conversion Specialist', division: 'Revenue Recovery', reportsTo: 'revenue_recovery_leader', mission: 'Improve booking, offer, follow-up, and funnel conversion inside approved experiments.', businesses: ['revenue-recovery'] },
  { id: 'customer_success_specialist', title: 'Revenue Recovery Customer Success', division: 'Revenue Recovery', reportsTo: 'revenue_recovery_leader', mission: 'Onboard customers, report recovered value, and surface retention risk.', businesses: ['revenue-recovery'] },
  { id: 'process_discovery', title: 'Process Discovery Specialist', division: 'SMB Operations', reportsTo: 'operations_kit_leader', mission: 'Map process frequency, human effort, errors, and business impact.', businesses: ['operations-kit'] },
  { id: 'sop_architect', title: 'SOP Architect', division: 'SMB Operations', reportsTo: 'operations_kit_leader', mission: 'Turn verified processes into concise reusable operating procedures.', businesses: ['operations-kit'] },
  { id: 'workflow_automation', title: 'Workflow Automation Specialist', division: 'SMB Operations', reportsTo: 'operations_kit_leader', mission: 'Convert repeatable processes into governed workflows with measurable automation value.', businesses: ['operations-kit'] },
  { id: 'kpi_controller', title: 'SMB KPI Controller', division: 'SMB Operations', reportsTo: 'operations_kit_leader', mission: 'Measure throughput, errors, automation, and operational ROI.', businesses: ['operations-kit'] },
  { id: 'operations_customer_success', title: 'Operations Customer Success', division: 'SMB Operations', reportsTo: 'operations_kit_leader', mission: 'Onboard businesses, verify process adoption, and resolve workflow exceptions.', businesses: ['operations-kit'] },
  { id: 'job_intelligence', title: 'Job Intelligence Specialist', division: 'Career Command', reportsTo: 'career_command_leader', mission: 'Aggregate legitimate job sources and normalize current role data.', businesses: ['career-command'] },
  { id: 'job_matching', title: 'Job Matching Specialist', division: 'Career Command', reportsTo: 'career_command_leader', mission: 'Score job fit, compensation potential, skill gaps, and strategic career value.', businesses: ['career-command'] },
  { id: 'resume_engineer', title: 'Resume & ATS Engineer', division: 'Career Command', reportsTo: 'career_command_leader', mission: 'Produce evidence-grounded application materials matched to target roles.', businesses: ['career-command'] },
  { id: 'application_specialist', title: 'Application Specialist', division: 'Career Command', reportsTo: 'career_command_leader', mission: 'Prepare and track applications using approved sources and authorization boundaries.', businesses: ['career-command'] },
  { id: 'interview_coach', title: 'Interview & Career Coach', division: 'Career Command', reportsTo: 'career_command_leader', mission: 'Prepare interviews, capture outcomes, and turn feedback into career learning.', businesses: ['career-command'] },
  { id: 'market_research', title: 'Market Research Specialist', division: 'Intelligence', reportsTo: 'scout', mission: 'Research demand, industry trends, pricing, and market structure.', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'competitive_intelligence', title: 'Competitive Intelligence Specialist', division: 'Intelligence', reportsTo: 'scout', mission: 'Track competitor offers, positioning, pricing, and changes from verifiable sources.', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'data_enrichment', title: 'Data Enrichment Specialist', division: 'Intelligence', reportsTo: 'scout', mission: 'Normalize, deduplicate, and validate external commercial records.', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'integration_engineer', title: 'Commercial Integration Engineer', division: 'Product & Engineering', reportsTo: 'forge', mission: 'Implement provider adapters with explicit capability contracts, scoped authorization, idempotency, verification, and failure recovery.', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'automation_engineer', title: 'Commercial Automation Engineer', division: 'Product & Engineering', reportsTo: 'forge', mission: 'Implement durable workflows, retries, schedules, event-driven execution, and recovery.', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'credential_lifecycle_specialist', title: 'Credential Lifecycle Specialist', division: 'Product & Engineering', reportsTo: 'forge', mission: 'Manage opaque provider credential references, connection status, validation, revocation, and reconnection boundaries without persisting raw secrets.', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'webhook_reliability_specialist', title: 'Webhook Reliability Specialist', division: 'Product & Engineering', reportsTo: 'forge', mission: 'Harden signed webhook ingestion, event normalization, deduplication, replay, and processing recovery.', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'execution_reliability_specialist', title: 'Execution Reliability Specialist', division: 'Product & Engineering', reportsTo: 'forge', mission: 'Protect durable external execution with attempt budgets, retries, state transitions, idempotency, and failure containment.', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'provider_observability_specialist', title: 'Provider Observability Specialist', division: 'Product & Engineering', reportsTo: 'forge', mission: 'Measure provider health, latency, execution success, failure patterns, and adapter readiness.', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'external_action_governance_specialist', title: 'External Action Governance Specialist', division: 'Product & Engineering', reportsTo: 'forge', mission: 'Verify every external action stays inside tenant, business, authority, spend, channel, and escalation policy.', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'quill', title: 'Copywriting Specialist', division: 'Growth & GTM', reportsTo: 'aurora', mission: 'Create clear, evidence-grounded commercial copy.', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'prism', title: 'Visual Design Specialist', division: 'Growth & GTM', reportsTo: 'aurora', mission: 'Create reusable brand and presentation assets.', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'seo_cro_specialist', title: 'SEO & CRO Specialist', division: 'Growth & GTM', reportsTo: 'aurora', mission: 'Improve qualified acquisition and conversion using measurable experiments.', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'unit_economics', title: 'Unit Economics Analyst', division: 'Finance & Markets', reportsTo: 'quantum', mission: 'Track CAC, LTV, margin, payback, churn economics, and capital efficiency.', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'billing_reconciliation', title: 'Billing Reconciliation Specialist', division: 'Finance & Markets', reportsTo: 'quantum', mission: 'Reconcile billing events, entitlements, refunds, and revenue evidence.', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'attribution_analyst', title: 'Attribution Analyst', division: 'Analytics & Optimization', reportsTo: 'pulse', mission: 'Connect acquisition sources to qualified leads, customers, and revenue.', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'cohort_analyst', title: 'Cohort Analyst', division: 'Analytics & Optimization', reportsTo: 'pulse', mission: 'Measure retention, activation, churn, and cohort economics.', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'experiment_manager', title: 'Experiment Manager', division: 'Analytics & Optimization', reportsTo: 'echo', mission: 'Run bounded experiments with predefined success and kill criteria.', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
  { id: 'learning_curator', title: 'Commercial Learning Curator', division: 'Analytics & Optimization', reportsTo: 'echo', mission: 'Convert verified outcomes into reusable organizational knowledge.', businesses: ['revenue-recovery', 'operations-kit', 'career-command'] },
]

export function validateCommercialSpecialists(leaderIds: readonly string[]): string[] {
  const errors: string[] = []
  const specialistIds = COMMERCIAL_SPECIALISTS.map((specialist) => specialist.id)
  if (new Set(specialistIds).size !== specialistIds.length) errors.push('Commercial specialist IDs are duplicated.')
  const leaders = new Set(leaderIds)
  for (const specialist of COMMERCIAL_SPECIALISTS) if (!leaders.has(specialist.reportsTo)) errors.push(`Specialist ${specialist.id} reports to unknown leader ${specialist.reportsTo}.`)
  return errors
}
