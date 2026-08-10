/**
 * Runtime autonomy boundary.
 *
 * The capability registry is the preferred source of side-effect metadata.
 * Unknown tools deliberately fall back to conservative name-based inference;
 * missing metadata can never grant autonomous authority.
 */

import {
  classifyAutonomyAction,
  type ActionCategory,
  type AutonomyPolicyDecision,
  type AutonomyPolicyLimits,
} from './autonomy-policy'
import { getCapabilityMetadata } from './capability-registry'

const LEGACY_DESTRUCTIVE_TOOLS = new Set([
  'file_delete', 'file_modify', 'file_write', 'patch_source_file', 'patch_applier',
  'restore_from_backup', 'backup_restore', 'db_migration_validator',
  'developer_database_migration', 'secrets_rotator', 'cache_clear',
])
const LEGACY_DEPLOYMENT_TOOLS = new Set([
  'trigger_redeploy', 'canary_deployment_manager', 'staging_environment_manager',
  'rollback_manager', 'developer_cicd_pipeline_builder',
])
const LEGACY_SECURITY_TOOLS = new Set([
  'security_auto_fixer', 'csrf_auditor', 'security_health_checker',
  'security_header_tester', 'rate_limit_tester', 'csp_diagnostic', 'secrets_rotator',
])
const LEGACY_FINANCIAL_TOOLS = new Set([
  'stripe_payment_processor', 'paypal_api', 'payment_processor', 'payout_scheduler',
  'kraken_exchange', 'quantum_staking_automation', 'advanced_billing', 'dunning_management',
])
const LEGACY_COMMUNICATION_TOOLS = new Set([
  'send_email', 'send_communication', 'send_whatsapp', 'send_sms', 'telegram_notify',
  'ntfy_notify', 'discord_notify', 'resend_email_automation', 'convertkit_email',
  'autonomous_email_sender', 'follow_up_automation',
])
const LEGACY_EXTERNAL_WRITE_TOOLS = new Set([
  'wordpress_publisher', 'etsy_integration', 'amazon_integration', 'marketplace_sync',
  'buffer_scheduler', 'shopify_store', 'fiverr_freelance', 'automated_social_posting',
  'auto_bidding_engine',
])

function finiteNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return value
}

function inferCost(args: Record<string, unknown>): number | undefined {
  for (const key of ['estimatedCost', 'estimated_cost', 'cost', 'amount', 'price', 'budget', 'spend']) {
    const value = finiteNumber(args[key])
    if (value !== undefined && value >= 0) return value
  }
  return undefined
}

function inferLegacyCategory(toolName: string): ActionCategory {
  if (LEGACY_DESTRUCTIVE_TOOLS.has(toolName)) return 'data_destructive'
  if (LEGACY_DEPLOYMENT_TOOLS.has(toolName)) return 'deployment'
  if (LEGACY_SECURITY_TOOLS.has(toolName)) return 'security'
  if (LEGACY_FINANCIAL_TOOLS.has(toolName)) return 'financial'
  if (LEGACY_COMMUNICATION_TOOLS.has(toolName)) return 'communication'
  if (LEGACY_EXTERNAL_WRITE_TOOLS.has(toolName)) return 'external_irreversible'
  if (/^(read|search|fetch|inspect|query|analy[sz]e|audit|check|verify|test|monitor|report|list|lookup|web_)/i.test(toolName)) return 'read'
  return 'write'
}

export function classifyToolExecution(
  toolName: string,
  rawArgs: unknown,
  options?: {
    policyApproved?: boolean
    confidence?: number
    affectsProduction?: boolean
    affectsSecurity?: boolean
    containsPersonalData?: boolean
    limits?: AutonomyPolicyLimits
  },
): AutonomyPolicyDecision {
  const args = rawArgs && typeof rawArgs === 'object' ? rawArgs as Record<string, unknown> : {}
  const metadata = getCapabilityMetadata(toolName)
  const category = metadata?.category ?? inferLegacyCategory(toolName)
  const confidence = options?.confidence ?? (category === 'read' ? 1 : 0)

  return classifyAutonomyAction({
    category,
    estimatedCost: inferCost(args),
    currency: typeof args.currency === 'string' ? args.currency : undefined,
    reversible: metadata?.reversible ?? (category === 'read' || category === 'write'),
    externalSideEffect: metadata?.externalSideEffect ?? (
      category === 'communication' || category === 'financial' || category === 'external_irreversible' ||
      /publish|send|post|schedule|payment|payout|marketplace|shopify|etsy|amazon/i.test(toolName)
    ),
    affectsProduction: options?.affectsProduction ?? metadata?.affectsProduction ?? LEGACY_DEPLOYMENT_TOOLS.has(toolName),
    affectsSecurity: options?.affectsSecurity ?? metadata?.affectsSecurity ?? LEGACY_SECURITY_TOOLS.has(toolName),
    affectsFinancialState: metadata?.affectsFinancialState ?? category === 'financial',
    containsPersonalData: options?.containsPersonalData ?? metadata?.containsPersonalData ?? false,
    // Explicit caller approval remains available for trusted higher-level
    // authorization flows, but the ordinary tool runtime must not inject it.
    policyApproved: options?.policyApproved ?? metadata?.autonomousEligible === true,
    confidence,
  }, options?.limits)
}

export function autonomyDenialMessage(toolName: string, decision: AutonomyPolicyDecision): string {
  return [
    `AUTONOMY GOVERNOR: Tool "${toolName}" was not authorized for autonomous execution.`,
    `Authority: ${decision.authority}.`,
    `Reason: ${decision.reason}`,
    decision.requiresOwnerApproval
      ? 'Owner approval is required before this action can execute.'
      : 'The action is forbidden by policy and cannot be executed autonomously.',
  ].join(' ')
}
