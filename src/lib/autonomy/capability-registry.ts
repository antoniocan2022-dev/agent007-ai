/**
 * Canonical capability metadata for autonomy authorization.
 *
 * Tools remain executable implementations; capabilities describe their
 * side-effect contract. Unknown tools fall back to conservative inference;
 * missing metadata can never grant autonomous authority.
 */

import type { ActionCategory } from './autonomy-policy'

export interface CapabilityMetadata {
  capability: string
  category: ActionCategory
  reversible: boolean
  externalSideEffect: boolean
  affectsProduction: boolean
  affectsSecurity: boolean
  affectsFinancialState: boolean
  containsPersonalData: boolean
  autonomousEligible: boolean
}

const registry: Record<string, CapabilityMetadata> = {}

function define(names: string[], metadata: CapabilityMetadata): void {
  const immutableMetadata = Object.freeze({ ...metadata })
  for (const name of names) registry[name] = immutableMetadata
}

const safeRead = {
  category: 'read' as const,
  reversible: true,
  externalSideEffect: false,
  affectsProduction: false,
  affectsSecurity: false,
  affectsFinancialState: false,
  containsPersonalData: false,
  autonomousEligible: true,
}

define([
  'web_search', 'page_reader', 'wikipedia_search', 'wikipedia_read', 'free_apis_directory',
  'kb_search', 'source_read', 'file_read', 'file_read_any', 'memory_recall',
  'github_search', 'reddit_search', 'hn_search', 'arxiv_search', 'pubmed_search',
  'google_scholar_search', 'semantic_scholar_search', 'openalex_search', 'core_search',
  'ddg_search', 'brave_search', 'searxng_search', 'http_fetch', 'tool_catalog',
  'tool_knowledge_base', 'tool_capability_map', 'tool_metadata_system',
  'tool_usage_analyzer', 'tool_usage_analytics', 'tool_boundary_audit',
  'tool_health_checker', 'tool_registry_auditor', 'tool_consistency_checker',
  'tool_usage_tracker', 'tool_audit_scheduler', 'security_health_checker',
  'security_header_tester', 'rate_limit_tester', 'csp_diagnostic',
], { capability: 'RESEARCH.READ', ...safeRead })

define(['memory_store', 'progress_tracker', 'report_progress', 'request_help', 'tool_cache'], {
  capability: 'MISSION.INTERNAL_BOOKKEEPING', category: 'write', reversible: true,
  externalSideEffect: false, affectsProduction: false, affectsSecurity: false,
  affectsFinancialState: false, containsPersonalData: false, autonomousEligible: true,
})

define(['verify_work', 'result_verifier', 'result_verifier_v2', 'quality_scorer', 'quality_scorer_v2', 'accuracy_checker'], {
  capability: 'MISSION.VERIFICATION', ...safeRead,
})

define(['image_gen', 'vision'], {
  capability: 'MISSION.INTERNAL_ARTIFACT_GENERATION', category: 'write', reversible: true,
  externalSideEffect: false, affectsProduction: false, affectsSecurity: false,
  affectsFinancialState: false, containsPersonalData: false, autonomousEligible: true,
})

// Arbitrary code execution is a security boundary and is never autonomous.
define(['code_exec'], {
  capability: 'DEVELOPMENT.EXECUTE_CODE', category: 'security', reversible: false,
  externalSideEffect: false, affectsProduction: false, affectsSecurity: true,
  affectsFinancialState: false, containsPersonalData: false, autonomousEligible: false,
})

define(['send_email', 'send_communication', 'send_whatsapp', 'send_sms', 'telegram_notify', 'discord_notify', 'ntfy_notify', 'autonomous_email_sender', 'resend_email_automation', 'convertkit_email', 'follow_up_automation', 'send_email_resend'], {
  capability: 'COMMUNICATION.EXTERNAL_SEND', category: 'communication', reversible: false,
  externalSideEffect: true, affectsProduction: false, affectsSecurity: false,
  affectsFinancialState: false, containsPersonalData: true, autonomousEligible: false,
})

define(['stripe_payment_processor', 'stripe_create_payment', 'paypal_api', 'payment_processor', 'payment_processing', 'payout_scheduler', 'kraken_exchange', 'quantum_staking_automation', 'advanced_billing', 'dunning_management'], {
  capability: 'FINANCE.EXTERNAL_TRANSACTION', category: 'financial', reversible: false,
  externalSideEffect: true, affectsProduction: false, affectsSecurity: false,
  affectsFinancialState: true, containsPersonalData: true, autonomousEligible: false,
})

define(['trigger_redeploy', 'canary_deployment_manager', 'staging_environment_manager', 'rollback_manager', 'developer_cicd_pipeline_builder'], {
  capability: 'DEPLOYMENT.CHANGE_RUNTIME', category: 'deployment', reversible: false,
  externalSideEffect: true, affectsProduction: true, affectsSecurity: false,
  affectsFinancialState: false, containsPersonalData: false, autonomousEligible: false,
})

define(['file_delete', 'file_modify', 'file_write', 'patch_source_file', 'patch_applier', 'restore_from_backup', 'backup_restore', 'db_migration_validator', 'developer_database_migration', 'database_manager', 'tool_fixer', 'tool_recovery', 'tool_self_healing_loop', 'subagent_tool_fixer', 'self_repair_add_tool'], {
  capability: 'DEVELOPMENT.MUTATE_SOURCE_OR_DATA', category: 'data_destructive', reversible: false,
  externalSideEffect: false, affectsProduction: false, affectsSecurity: true,
  affectsFinancialState: false, containsPersonalData: false, autonomousEligible: false,
})

define(['security_auto_fixer', 'secrets_rotator', 'csrf_auditor'], {
  capability: 'SECURITY.MUTATE_CONTROL_PLANE', category: 'security', reversible: false,
  externalSideEffect: false, affectsProduction: true, affectsSecurity: true,
  affectsFinancialState: false, containsPersonalData: false, autonomousEligible: false,
})

define(['wordpress_publisher', 'etsy_integration', 'amazon_integration', 'marketplace_sync', 'buffer_scheduler', 'shopify_store', 'fiverr_freelance', 'automated_social_posting', 'auto_bidding_engine'], {
  capability: 'BUSINESS.EXTERNAL_PUBLISH_OR_WRITE', category: 'external_irreversible', reversible: false,
  externalSideEffect: true, affectsProduction: false, affectsSecurity: false,
  affectsFinancialState: false, containsPersonalData: true, autonomousEligible: false,
})

// Explicitly governed external account/content setup and scheduling tools.
define(['api_integration', 'email_automation', 'ui_form_builder', 'website_builder', 'course_creation', 'email_marketing_setup', 'payment_integration', 'calendar_schedule', 'notion_create_page', 'github_create_repo'], {
  capability: 'BUSINESS.EXTERNAL_CONFIGURATION_OR_WRITE', category: 'external_irreversible', reversible: false,
  externalSideEffect: true, affectsProduction: false, affectsSecurity: false,
  affectsFinancialState: false, containsPersonalData: true, autonomousEligible: false,
})

// Internal analysis/coordination tools are safe only when they do not mutate
// source, production state, external systems, or financial state.
define(['tool_coordination_matrix', 'tool_selection_accuracy_test', 'accuracy_benchmark', 'integration_test_suite', 'performance_optimizer', 'execution_time_optimizer', 'advanced_trend_analyzer', 'cross_stream_analytics', 'decision_matrix', 'decision_feedback_loop'], {
  capability: 'MISSION.INTERNAL_ANALYSIS', ...safeRead,
})

/**
 * Stable read-only view exported for audit tooling and tests.
 * Both the map and each metadata object are frozen so diagnostics cannot
 * mutate the authorization contract at runtime.
 */
export const CAPABILITY_REGISTRY: Readonly<Record<string, Readonly<CapabilityMetadata>>> = Object.freeze(registry)

export function getCapabilityMetadata(toolName: string): Readonly<CapabilityMetadata> | undefined {
  return registry[toolName]
}

export function listCapabilityMetadata(): Readonly<Record<string, Readonly<CapabilityMetadata>>> {
  return registry
}

export function isCapabilityRegistered(toolName: string): boolean {
  return Object.prototype.hasOwnProperty.call(registry, toolName)
}
