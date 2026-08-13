import type { CommercialBusiness } from './commercial-control-plane'

export type CommercialCapabilityStatus = 'ready' | 'partial' | 'adapter-required'

export interface CommercialCapability {
  id: string
  name: string
  ownerDivision: string
  businesses: CommercialBusiness[]
  status: CommercialCapabilityStatus
  currentTools: string[]
  requiredAdapters: string[]
  purpose: string
}

export const COMMERCIAL_CAPABILITIES: readonly CommercialCapability[] = [
  { id: 'COMMERCIAL.TENANCY', name: 'Tenant isolation and business workspace', ownerDivision: 'Executive Office', businesses: ['revenue-recovery', 'operations-kit', 'career-command'], status: 'ready', currentTools: ['memory_store', 'memory_recall'], requiredAdapters: [], purpose: 'Keep each customer/business workspace isolated and auditable.' },
  { id: 'COMMERCIAL.CRM', name: 'Customer and relationship management', ownerDivision: 'Revenue & Market', businesses: ['revenue-recovery', 'operations-kit', 'career-command'], status: 'partial', currentTools: ['memory_store', 'memory_recall'], requiredAdapters: ['crm-provider'], purpose: 'Manage prospects, customers, contacts, activities, opportunities, and lifecycle state.' },
  { id: 'COMMERCIAL.EVENTS', name: 'Durable business event ledger', ownerDivision: 'Operations & Reliability', businesses: ['revenue-recovery', 'operations-kit', 'career-command'], status: 'ready', currentTools: ['memory_store', 'memory_recall'], requiredAdapters: [], purpose: 'Give every commercial workflow a durable, idempotent event history.' },
  { id: 'COMMERCIAL.WORKFLOWS', name: 'Durable workflow orchestration', ownerDivision: 'Product & Engineering', businesses: ['revenue-recovery', 'operations-kit', 'career-command'], status: 'partial', currentTools: ['workflow_orchestrator', 'task_automation_expander', 'phase6_execution_runtime'], requiredAdapters: ['durable-worker-runtime'], purpose: 'Persist execution state, retries, schedules, and recovery across external work.' },
  { id: 'COMMERCIAL.CREDENTIALS', name: 'Credential reference and connection control', ownerDivision: 'Security', businesses: ['revenue-recovery', 'operations-kit', 'career-command'], status: 'partial', currentTools: ['memory_store', 'phase6_credential_lifecycle'], requiredAdapters: ['secret-vault', 'oauth-connection-manager'], purpose: 'Store only opaque provider credential references, connection status, scopes, and lifecycle evidence.' },
  { id: 'COMMERCIAL.BILLING', name: 'Billing, payments, refunds and entitlements', ownerDivision: 'Finance & Markets', businesses: ['revenue-recovery', 'operations-kit', 'career-command'], status: 'partial', currentTools: ['stripe_payment_processor', 'payment_processor', 'financial_tracker'], requiredAdapters: ['payment-provider-adapter'], purpose: 'Reconcile commercial money with customer entitlements and audit trails.' },
  { id: 'COMMERCIAL.COMMUNICATIONS', name: 'Email, SMS, WhatsApp and transactional messaging', ownerDivision: 'Revenue & Market', businesses: ['revenue-recovery', 'operations-kit', 'career-command'], status: 'partial', currentTools: ['send_email', 'send_sms', 'send_whatsapp', 'follow_up_automation', 'phase6_provider_adapter'], requiredAdapters: ['communications-provider'], purpose: 'Execute approved customer communication within delegated authority.' },
  { id: 'COMMERCIAL.EVIDENCE', name: 'Verified commercial evidence ledger', ownerDivision: 'Analytics & Optimization', businesses: ['revenue-recovery', 'operations-kit', 'career-command'], status: 'ready', currentTools: ['accuracy_checker', 'result_verifier_v2', 'memory_store'], requiredAdapters: [], purpose: 'Separate forecasts and AI-generated claims from observed, verified business outcomes.' },
  { id: 'COMMERCIAL.AUTHORITY', name: 'Delegated business authority', ownerDivision: 'Executive Office', businesses: ['revenue-recovery', 'operations-kit', 'career-command'], status: 'ready', currentTools: ['approval_audit_log', 'memory_store', 'phase6_action_gateway'], requiredAdapters: [], purpose: 'Permit autonomous execution only inside explicit customer/business limits.' },
  { id: 'COMMERCIAL.AUDIT', name: 'Commercial audit and outcome lineage', ownerDivision: 'Governance', businesses: ['revenue-recovery', 'operations-kit', 'career-command'], status: 'ready', currentTools: ['approval_audit_log', 'continuous_audit_system'], requiredAdapters: [], purpose: 'Make every material commercial decision and external action traceable.' },
  { id: 'COMMERCIAL.ANALYTICS', name: 'Revenue, funnel, cohort and unit-economics intelligence', ownerDivision: 'Analytics & Optimization', businesses: ['revenue-recovery', 'operations-kit', 'career-command'], status: 'partial', currentTools: ['cross_stream_analytics', 'performance_attribution', 'automated_reporting_dashboard', 'phase6_provider_observability'], requiredAdapters: ['analytics-event-sink'], purpose: 'Turn commercial events into KPI, attribution, LTV, CAC and health evidence.' },
  { id: 'COMMERCIAL.INTEGRATIONS', name: 'Provider adapter registry and external-system boundary', ownerDivision: 'Product & Engineering', businesses: ['revenue-recovery', 'operations-kit', 'career-command'], status: 'ready', currentTools: ['phase6_provider_registry', 'phase6_provider_adapter'], requiredAdapters: [], purpose: 'Give every external provider a single governed adapter contract with explicit capabilities and environments.' },
  { id: 'COMMERCIAL.ACTION_GATEWAY', name: 'External action authorization and execution gateway', ownerDivision: 'Product & Engineering', businesses: ['revenue-recovery', 'operations-kit', 'career-command'], status: 'ready', currentTools: ['phase6_action_gateway', 'approval_audit_log'], requiredAdapters: [], purpose: 'Prevent autonomous actions outside tenant, business, authority, spend, channel, and rate limits.' },
  { id: 'COMMERCIAL.WEBHOOKS', name: 'Signed webhook and event ingestion gateway', ownerDivision: 'Operations & Reliability', businesses: ['revenue-recovery', 'operations-kit', 'career-command'], status: 'ready', currentTools: ['phase6_webhook_gateway'], requiredAdapters: [], purpose: 'Normalize external events with signature verification, idempotency, processing state, and commercial event lineage.' },
  { id: 'COMMERCIAL.PROVIDER_OBSERVABILITY', name: 'Provider health and execution telemetry', ownerDivision: 'Operations & Reliability', businesses: ['revenue-recovery', 'operations-kit', 'career-command'], status: 'ready', currentTools: ['phase6_provider_observability'], requiredAdapters: [], purpose: 'Measure provider failures, successes, execution attempts, and current health without exposing secrets.' },
  { id: 'COMMERCIAL.SANDBOX', name: 'Safe integration sandbox and replay surface', ownerDivision: 'Product & Engineering', businesses: ['revenue-recovery', 'operations-kit', 'career-command'], status: 'ready', currentTools: ['phase6_sandbox_mode', 'phase6_webhook_replay'], requiredAdapters: [], purpose: 'Exercise integrations and event flows without sending live customer-facing actions.' },
] as const

export function validateCommercialCapabilityMap(): string[] {
  const errors: string[] = []
  const ids = COMMERCIAL_CAPABILITIES.map((capability) => capability.id)
  if (new Set(ids).size !== ids.length) errors.push('Commercial capability IDs are duplicated.')
  for (const capability of COMMERCIAL_CAPABILITIES) {
    if (!capability.name.trim()) errors.push(`Capability ${capability.id} has no name.`)
    if (capability.businesses.length === 0) errors.push(`Capability ${capability.id} has no business scope.`)
    if (capability.status === 'adapter-required' && capability.requiredAdapters.length === 0) errors.push(`Capability ${capability.id} requires an adapter but declares none.`)
  }
  return errors
}
