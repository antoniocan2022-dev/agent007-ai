/**
 * manage-actions.ts — Canonical list of all management actions supported by
 * the orchestrator's executeManageAction() switch/case block.
 *
 * WHY A SEPARATE FILE?
 *   - `system-functions.ts` needs to read the action list for capabilities
 *     reporting.
 *   - `orchestrator.ts` needs the same list for validation.
 *   - Both files already cross-import each other, so we extract this list
 *     into a leaf module to break the circular dependency cleanly.
 *
 * HOW TO KEEP IN SYNC:
 *   When you add/remove a `case '<name>':` in orchestrator.ts → executeManageAction(),
 *   ALSO add/remove the same name here. The capabilities reporter reads THIS
 *   list, not the switch statement, so an out-of-sync list will show wrong
 *   numbers to the agent/dashboard.
 */

export const MANAGE_ACTIONS: readonly string[] = [
  // ── Sub-agent management ──────────────────────────────────────────────
  'create_agent',
  'edit_agent',
  'delete_agent',
  'toggle_agent',

  // ── Income & growth ───────────────────────────────────────────────────
  'set_income_goal',
  'set_growth_target',
  'log_income',

  // ── Schedules ─────────────────────────────────────────────────────────
  'create_schedule',
  'delete_schedule',

  // ── Settings ──────────────────────────────────────────────────────────
  'update_settings',
  'settings_set',
  'settings_get',
  'settings_delete',

  // ── Dashboard widgets ─────────────────────────────────────────────────
  'dashboard_add_widget',
  'dashboard_edit_widget',
  'dashboard_remove_widget',
  'dashboard_clear_widgets',

  // ── Login page / 2FA ──────────────────────────────────────────────────
  'login_update_branding',
  'login_enable_2fa',
  'login_verify_2fa',
  'login_disable_2fa',

  // ── TOTP owner auth ───────────────────────────────────────────────────
  'totp_setup',
  'totp_verify',
  'totp_disable',

  // ── Owner auth (WhatsApp/SMS/email) ───────────────────────────────────
  'verify_owner_auth',
  'request_owner_auth',

  // ── System operations ─────────────────────────────────────────────────
  'system_refresh',
  'system_reload',
  'system_audit',
  'system_test_communication',
  'self_heal',
  'view_manifest',
  'view_capabilities',

  // ── Backups ───────────────────────────────────────────────────────────
  'create_backup',
  'list_backups',
  'load_backup',

  // ── Diagnostics & repair ──────────────────────────────────────────────
  'fix_hydration',
  'clear_cache',

  // ── Tool protection (owner-authorized removal flow) ───────────────────
  'list_tools',
  'request_tool_removal',
  'verify_tool_removal',

  // ── Execution protection (owner-authorized execution flow) ────────────
  'request_tool_execution',
  'verify_tool_execution',
] as const

/**
 * Convenience count — same as `MANAGE_ACTIONS.length` but exposed as a
 * named constant for capabilities reports that want a stable identifier.
 */
export const MANAGE_ACTION_COUNT: number = MANAGE_ACTIONS.length

/**
 * Returns true if `name` is a registered management action.
 */
export function isManageAction(name: string): boolean {
  return (MANAGE_ACTIONS as readonly string[]).includes(name)
}
