/**
 * Canonical capability metadata for autonomy authorization.
 *
 * This registry is intentionally a sidecar to TOOL_REGISTRY: tools remain
 * executable implementations, while capabilities describe their side effects
 * and authority requirements. Unknown tools MUST fall back to conservative
 * classification in autonomy-runtime.ts; absence of metadata can never grant
 * autonomous authority.
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
  /** If true, policy approval may permit bounded autonomous execution. */
  autonomousEligible: boolean
}

const registry: Record<string, CapabilityMetadata> = {}

function define(
  names: string[],
  metadata: CapabilityMetadata,
): void {
  for (const name of names) registry[name] = metadata
}

define([
  'web_search', 'page_reader', 'wikipedia_search', 'wikipedia_read',
  'free_apis_directory', 'kb_search', 'source_read', 'file_read', 'file_read_any',
  'memory_recall', 'github_search', 'reddit_search', 'arxiv_search', 'pubmed_search',
  'google_scholar_search', 'semantic_scholar_search', 'openalex_search', 'core_search',
  'ddg_search', 'brave_search', 'searxng_search', 'http_fetch',
], {
  capability: 'RESEARCH.READ',
  category: 'read',
  reversible: true,
  externalSideEffect: false,
  affectsProduction: false,
  affectsSecurity: false,
  affectsFinancialState: false,
  containsPersonalData: false,
  autonomousEligible: true,
})

define(['memory_store', 'progress_tracker', 'report_progress', 'request_help'], {
  capability: 'MISSION.INTERNAL_BOOKKEEPING',
  category: 'write',
  reversible: true,
  externalSideEffect: false,
  affectsProduction: false,
  affectsSecurity: false,
  affectsFinancialState: false,
  containsPersonalData: false,
  autonomousEligible: true,
})

define(['verify_work', 'result_verifier', 'result_verifier_v2', 'quality_scorer', 'quality_scorer_v2', 'accuracy_checker'], {
  capability: 'MISSION.VERIFICATION',
  category: 'read',
  reversible: true,
  externalSideEffect: false,
  affectsProduction: false,
  affectsSecurity: false,
  affectsFinancialState: false,
  containsPersonalData: false,
  autonomousEligible: true,
})

define(['send_email', 'send_communication', 'send_whatsapp', 'send_sms', 'telegram_notify', 'discord_notify', 'ntfy_notify', 'autonomous_email_sender'], {
  capability: 'COMMUNICATION.EXTERNAL_SEND',
  category: 'communication',
  reversible: false,
  externalSideEffect: true,
  affectsProduction: false,
  affectsSecurity: false,
  affectsFinancialState: false,
  containsPersonalData: true,
  autonomousEligible: false,
})

define(['stripe_payment_processor', 'paypal_api', 'payment_processor', 'payout_scheduler', 'advanced_billing', 'dunning_management'], {
  capability: 'FINANCE.EXTERNAL_TRANSACTION',
  category: 'financial',
  reversible: false,
  externalSideEffect: true,
  affectsProduction: false,
  affectsSecurity: false,
  affectsFinancialState: true,
  containsPersonalData: true,
  autonomousEligible: false,
})

define(['trigger_redeploy', 'canary_deployment_manager', 'staging_environment_manager', 'rollback_manager', 'developer_cicd_pipeline_builder'], {
  capability: 'DEPLOYMENT.CHANGE_RUNTIME',
  category: 'deployment',
  reversible: false,
  externalSideEffect: true,
  affectsProduction: true,
  affectsSecurity: false,
  affectsFinancialState: false,
  containsPersonalData: false,
  autonomousEligible: false,
})

define(['file_delete', 'file_modify', 'file_write', 'patch_source_file', 'patch_applier', 'restore_from_backup', 'backup_restore', 'developer_database_migration'], {
  capability: 'DEVELOPMENT.MUTATE_SOURCE_OR_DATA',
  category: 'data_destructive',
  reversible: false,
  externalSideEffect: false,
  affectsProduction: false,
  affectsSecurity: true,
  affectsFinancialState: false,
  containsPersonalData: false,
  autonomousEligible: false,
})

define(['security_auto_fixer', 'secrets_rotator'], {
  capability: 'SECURITY.MUTATE_CONTROL_PLANE',
  category: 'security',
  reversible: false,
  externalSideEffect: false,
  affectsProduction: true,
  affectsSecurity: true,
  affectsFinancialState: false,
  containsPersonalData: false,
  autonomousEligible: false,
})

define(['wordpress_publisher', 'etsy_integration', 'amazon_integration', 'marketplace_sync', 'buffer_scheduler', 'shopify_store', 'fiverr_freelance', 'automated_social_posting', 'auto_bidding_engine'], {
  capability: 'BUSINESS.EXTERNAL_PUBLISH_OR_WRITE',
  category: 'external_irreversible',
  reversible: false,
  externalSideEffect: true,
  affectsProduction: false,
  affectsSecurity: false,
  affectsFinancialState: false,
  containsPersonalData: true,
  autonomousEligible: false,
})

export function getCapabilityMetadata(toolName: string): CapabilityMetadata | undefined {
  return registry[toolName]
}

export function listCapabilityMetadata(): Readonly<Record<string, CapabilityMetadata>> {
  return registry
}
