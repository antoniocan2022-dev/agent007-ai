import { describe, expect, test } from 'bun:test'
import { isConversationalMemoryVisible, getConversationalVisibleCategories } from '@/lib/ceo-memory-visibility'

// Every real memory category found anywhere in this codebase at the time of this audit
// (grep -rhoE "category:\s*'[a-z_]+'" src/lib/), captured as a permanent regression fixture so
// this exhaustive check keeps running even as new categories are added elsewhere.
const ALL_REAL_CATEGORIES = [
  'adaptive_weights', 'ai_business_service', 'architecture_artifact', 'architecture_artifact_event',
  'architecture_business_outcome', 'autonomy', 'autonomy_due_work', 'behavior', 'behavioral_learning_candidate',
  'business_intelligence', 'business_portfolio', 'business_retirement_log', 'capability_runtime',
  'career_command_application', 'career_command_application_approval', 'career_command_job', 'career_command_profile',
  'ceo_communication_dedup', 'ceo_conversation_incident', 'ceo_observed_outcome', 'ceo_recommendation',
  'ceo_recommendation_action', 'code_bug', 'cold_email', 'commercial_evidence', 'communication', 'compliance',
  'compute', 'consulting', 'content_creation', 'continuous_loop_trace', 'critical', 'cross_business_insight',
  'dashboard', 'data', 'data_destructive', 'database', 'dedup_lock', 'deployment', 'evidence_trace',
  'evolution_report', 'executive_audit', 'executive_brief', 'external_irreversible', 'fetch', 'finance',
  'financial', 'flywheel_cycle', 'governance', 'governed_evolution_cycle', 'identity', 'improvement_initiative',
  'intelligence', 'irreversibility', 'live_monitoring_alerts', 'llm', 'market', 'media', 'memory', 'mission',
  'mission_drift', 'mission_outcome', 'mission_telemetry', 'network', 'operational_kpi_snapshot',
  'operations_kit_observation', 'org_knowledge', 'payment', 'persistence', 'portfolio_experiment_attribution',
  'portfolio_intelligence_decision', 'portfolio_intelligence_experiment', 'portfolio_intelligence_heartbeat',
  'portfolio_intelligence_heartbeat_lease', 'portfolio_intelligence_learning', 'portfolio_intelligence_snapshot',
  'portfolio_learning_cycle_error', 'portfolio_reallocation', 'quality', 'rate_limit', 'read', 'resource',
  'revenue_recovery_outcome', 'revenue_recovery_snapshot', 'saas', 'safety', 'search', 'security', 'self_heal',
  'self_healing_log', 'server_error', 'subagent', 'telehealth', 'translation', 'venture_autonomy',
  'venture_autonomy_lease', 'venture_book_production', 'venture_control_contract', 'venture_decision_audit',
  'venture_evidence', 'venture_identity', 'venture_mission_execution_lease', 'venture_operation_checkpoint',
  'venture_reference', 'venture_template', 'whatsapp', 'write',
]

describe('Structural fix: fail-closed allowlist, replacing the reactive blocklist', () => {
  test('an exhaustive audit of every real category used anywhere in this codebase confirms only the explicitly allowlisted ones are visible to conversation -- everything else, known or future, is internal by default', () => {
    const stillVisible = ALL_REAL_CATEGORIES.filter((category) => isConversationalMemoryVisible({ key: `${category}_1`, category }))
    const allowlist = new Set(getConversationalVisibleCategories())
    expect(stillVisible.every((category) => allowlist.has(category))).toBe(true)
    expect(stillVisible).toEqual(['mission'])
  })

  test('governed_evolution_cycle and continuous_loop_trace -- the two categories found leaking in real live transcripts -- are excluded under the new model, the same as every other non-allowlisted category', () => {
    expect(isConversationalMemoryVisible({ key: 'x', category: 'governed_evolution_cycle' })).toBe(false)
    expect(isConversationalMemoryVisible({ key: 'x', category: 'continuous_loop_trace' })).toBe(false)
  })

  test('a category never seen before (simulating tomorrow\'s new internal system) is internal by default, closing the exact failure mode that let two real categories leak twice already', () => {
    expect(isConversationalMemoryVisible({ key: 'x', category: 'some_brand_new_internal_thing_nobody_registered_yet' })).toBe(false)
  })

  test('the confirmed-legitimate conversational categories remain visible', () => {
    expect(isConversationalMemoryVisible({ key: 'general_1', category: 'general' })).toBe(true)
    expect(isConversationalMemoryVisible({ key: 'mission-42-priority', category: 'mission' })).toBe(true)
  })
})
