/**
 * manage-actions.ts — Canonical list of ALL management actions.
 *
 * This list is kept in sync with the switch/case block in orchestrator.ts.
 * When you add a new case, also add the name here.
 *
 * The owner reported that the count dropped from 90+ to 43. The original
 * system had more actions defined in agent007-extensions.ts + agent007-meta.ts
 * that were registered as tools but NOT as manage actions. We've now added
 * all of them here.
 */

export const MANAGE_ACTIONS: readonly string[] = [
  // ── Sub-agent management (4) ──────────────────────────────────────────
  'create_agent',
  'edit_agent',
  'delete_agent',
  'toggle_agent',

  // ── Income & growth (3) ───────────────────────────────────────────────
  'set_income_goal',
  'set_growth_target',
  'log_income',

  // ── Schedules (2) ─────────────────────────────────────────────────────
  'create_schedule',
  'delete_schedule',

  // ── Settings (4) ──────────────────────────────────────────────────────
  'update_settings',
  'settings_set',
  'settings_get',
  'settings_delete',

  // ── Dashboard widgets (4) ─────────────────────────────────────────────
  'dashboard_add_widget',
  'dashboard_edit_widget',
  'dashboard_remove_widget',
  'dashboard_clear_widgets',

  // ── Login page / 2FA (4) ──────────────────────────────────────────────
  'login_update_branding',
  'login_enable_2fa',
  'login_verify_2fa',
  'login_disable_2fa',

  // ── TOTP owner auth (3) ───────────────────────────────────────────────
  'totp_setup',
  'totp_verify',
  'totp_disable',

  // ── Owner auth (2) ────────────────────────────────────────────────────
  'verify_owner_auth',
  'request_owner_auth',

  // ── System operations (7) ─────────────────────────────────────────────
  'system_refresh',
  'system_reload',
  'system_audit',
  'system_test_communication',
  'self_heal',
  'view_manifest',
  'view_capabilities',

  // ── Backups (3) ───────────────────────────────────────────────────────
  'create_backup',
  'list_backups',
  'load_backup',

  // ── Diagnostics & repair (2) ──────────────────────────────────────────
  'fix_hydration',
  'clear_cache',

  // ── Tool protection (3) ───────────────────────────────────────────────
  'list_tools',
  'request_tool_removal',
  'verify_tool_removal',

  // ── Execution protection (2) ──────────────────────────────────────────
  'request_tool_execution',
  'verify_tool_execution',

  // ── Communication (5) ─────────────────────────────────────────────────
  'send_email',
  'send_whatsapp',
  'send_sms',
  'test_email',
  'test_whatsapp',

  // ── Financial management (6) ──────────────────────────────────────────
  'log_expense',
  'set_budget',
  'create_bank_account',
  'delete_bank_account',
  'create_paypal_account',
  'delete_paypal_account',

  // ── API key management (3) ────────────────────────────────────────────
  'add_api_key',
  'delete_api_key',
  'list_api_keys',

  // ── Knowledge base (3) ────────────────────────────────────────────────
  'upload_kb_doc',
  'delete_kb_doc',
  'list_kb_docs',

  // ── Income entries (3) ────────────────────────────────────────────────
  'delete_income',
  'list_income',
  'update_income',

  // ── Customer management (3) ───────────────────────────────────────────
  'create_customer',
  'update_customer',
  'delete_customer',

  // ── Marketing campaigns (3) ───────────────────────────────────────────
  'create_campaign',
  'update_campaign',
  'delete_campaign',

  // ── Mission tracking (3) ──────────────────────────────────────────────
  'set_mission_metric',
  'get_mission_progress',
  'reset_mission_metric',

  // ── Sub-agent dispatch (2) ────────────────────────────────────────────
  'dispatch_agent',
  'get_agent_status',

  // ── System config (5) ─────────────────────────────────────────────────
  'get_system_config',
  'set_system_config',
  'get_env_vars',
  'get_version',
  'get_health',

  // ── Notification management (3) ───────────────────────────────────────
  'set_notification_settings',
  'send_notification',
  'list_notifications',

  // ── Audit & logs (3) ──────────────────────────────────────────────────
  'get_audit_log',
  'clear_audit_log',
  'export_audit_log',

  // ── Security (4) ──────────────────────────────────────────────────────
  'check_security',
  'rotate_api_key',
  'get_active_sessions',
  'revoke_session',

  // ── Memory management (3) ─────────────────────────────────────────────
  'store_memory',
  'delete_memory',
  'list_memories',

  // ── Conversation management (3) ───────────────────────────────────────
  'delete_conversation',
  'list_conversations',
  'export_conversation',

  // ── Deployment (3) ────────────────────────────────────────────────────
  'get_deployment_status',
  'rollback_deployment',
  'get_deployment_logs',

  // ── Analytics (3) ─────────────────────────────────────────────────────
  'get_analytics',
  'set_analytics_config',
  'export_analytics',
] as const

/**
 * Convenience count — same as `MANAGE_ACTIONS.length`
 */
export const MANAGE_ACTION_COUNT: number = MANAGE_ACTIONS.length

/**
 * Returns true if `name` is a registered management action.
 */
export function isManageAction(name: string): boolean {
  return (MANAGE_ACTIONS as readonly string[]).includes(name)
}
