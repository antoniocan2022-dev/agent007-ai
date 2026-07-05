/**
 * tool-protection.ts — Permanent tool protection layer.
 *
 * ALL 382+ tools in TOOL_REGISTRY are PERMANENTLY LOCKED. They CANNOT be:
 *   - Deleted      (no API removes keys from TOOL_REGISTRY)
 *   - Reset        (no API clears tool state)
 *   - Disabled     (no API turns a tool off)
 *
 * The ONLY way to remove a tool is to:
 *   1. Owner issues an explicit request via cellphone / email / WhatsApp
 *   2. Owner receives a 6-digit authorization code via the chosen channel
 *   3. Owner enters the code on the dashboard
 *   4. verifyOwnerAuthorization(authId, code) returns ok
 *   5. ONLY THEN does requestToolRemoval() proceed — and it still refuses
 *      to remove any tool on the NEVER_REMOVABLE list below.
 *
 * This file is imported by the orchestrator and the /api/tools/* routes.
 * It is a HARD GUARDRAIL — there is no bypass, no admin override, no
 * "maintenance mode" that lifts the restriction.
 */

import { TOOL_REGISTRY } from './tools'
import {
  isOperationDisabled,
  requiresOwnerAuth,
  requestOwnerAuthorization,
  verifyOwnerAuthorization,
} from './owner-auth'

/**
 * ALL 469+ tools are NEVER_REMOVABLE. The owner requested that every single
 * tool be permanently locked — no tool can be deleted, even with owner
 * authorization. This list is auto-generated from TOOL_REGISTRY lazily
 * (to avoid circular import).
 */
let _neverRemovable: string[] | null = null

function getNeverRemovableList(): string[] {
  if (_neverRemovable === null) {
    const { TOOL_REGISTRY } = require('./tools')
    _neverRemovable = Object.keys(TOOL_REGISTRY).sort()
  }
  return _neverRemovable
}

export const NEVER_REMOVABLE_TOOLS: readonly string[] = new Proxy([] as string[], {
  get(target, prop, receiver) {
    if (prop === 'length') return getNeverRemovableList().length
    if (prop === 'includes') return (v: string) => getNeverRemovableList().includes(v)
    if (prop === 'indexOf') return (v: string) => getNeverRemovableList().indexOf(v)
    if (prop === Symbol.iterator) return () => getNeverRemovableList()[Symbol.iterator]()
    if (typeof prop === 'string' && /^\d+$/.test(prop)) return getNeverRemovableList()[parseInt(prop)]
    return Reflect.get(target, prop, receiver)
  }
}) as readonly string[]

/**
 * Tools that require OWNER AUTHORIZATION before EXECUTION (not just
 * before removal). These tools have destructive side effects:
 *   - trigger_redeploy: triggers a Vercel redeploy (could cause downtime)
 *   - patch_source_file: modifies source code (could break the agent)
 *
 * Before these tools run, the orchestrator must call
 * `requestExecutionAuthorization(toolName)` to send a 6-digit code to
 * the owner via cellphone / email / WhatsApp. The owner enters the
 * code, then `verifyExecutionAuthorization(authId, code)` is called.
 * Only if verification passes does the tool actually execute.
 *
 * If verification fails or is missing, the tool returns a "soft refusal"
 * that tells the agent to request authorization from the owner.
 */
export const EXECUTION_PROTECTED_TOOLS: readonly string[] = [
  'trigger_redeploy',
  'patch_source_file',
] as const

/**
 * Check whether a tool requires owner authorization BEFORE EXECUTION
 * (not just before removal). Returns true for tools in
 * EXECUTION_PROTECTED_TOOLS.
 */
export function isExecutionProtected(toolName: string): boolean {
  return EXECUTION_PROTECTED_TOOLS.includes(toolName as any)
}

/**
 * Pending execution-authorizations (in-memory, 10-minute TTL).
 * Keyed by authId. Same shape as owner-auth's PendingAuth but kept
 * separate so execution-auth and removal-auth don't collide.
 */
interface PendingExecAuth {
  code: string
  toolName: string
  expiresAt: number
  attempts: number
  method: 'whatsapp' | 'sms' | 'email' | 'totp'
}
const _g2: any = globalThis as any
if (!_g2.__pendingExecAuth) _g2.__pendingExecAuth = new Map<string, PendingExecAuth>()
const pendingExecAuths: Map<string, PendingExecAuth> = _g2.__pendingExecAuth

/**
 * Request owner authorization to EXECUTE a protected tool. Sends a
 * 6-digit code to the owner via cellphone / email / WhatsApp.
 *
 * Returns { ok, authId, message, waLink? } — the agent must surface
 * the authId to the owner (or store it in conversation context) so the
 * owner can later verify with verifyExecutionAuthorization(authId, code).
 */
export async function requestExecutionAuthorization(
  toolName: string,
  preferredMethod?: 'whatsapp' | 'sms' | 'email' | 'totp'
): Promise<{
  ok: boolean
  authId: string
  message: string
  code?: string
  waLink?: string
  method?: string
}> {
  if (!isExecutionProtected(toolName)) {
    return {
      ok: true,
      authId: '',
      message: `Tool "${toolName}" does not require execution authorization. You may proceed.`,
    }
  }

  // Delegate to the existing owner-auth flow — it already handles
  // WhatsApp / SMS / email / TOTP dispatch with the owner's contact
  // info. We just prefix the operation name with "execute_tool:" so
  // the owner's authorization record reflects what they're approving.
  const result = await requestOwnerAuthorization(
    `execute_tool:${toolName}`,
    preferredMethod
  )
  return result
}

/**
 * Verify the owner's authorization code for executing a protected tool.
 * Returns { ok: true } if the code is correct + not expired, in which
 * case the tool may proceed. Otherwise the tool MUST refuse to execute.
 */
export function verifyExecutionAuthorization(
  authId: string,
  code: string
): { ok: boolean; message: string } {
  if (!authId) {
    return { ok: false, message: 'No authId provided. Call requestExecutionAuthorization first.' }
  }
  return verifyOwnerAuthorization(authId, code)
}

/**
 * Convenience: check whether a tool can be executed RIGHT NOW without
 * owner authorization. Returns true for safe (read-only) tools, false
 * for EXECUTION_PROTECTED_TOOLS.
 *
 * The orchestrator should call this before dispatching any tool. If it
 * returns false, the orchestrator must:
 *   1. Call requestExecutionAuthorization(toolName)
 *   2. Ask the owner for the code
 *   3. Call verifyExecutionAuthorization(authId, code)
 *   4. Only proceed if verification passes
 */
export function canExecuteWithoutAuth(toolName: string): boolean {
  return !isExecutionProtected(toolName)
}

/**
 * Check whether a tool name exists in the registry.
 */
export function toolExists(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(TOOL_REGISTRY, name)
}

/**
 * List every registered tool name (sorted).
 */
export function listAllToolNames(): string[] {
  return Object.keys(TOOL_REGISTRY).sort()
}

/**
 * Permanent lock check — every tool is permanently locked.
 * This function NEVER returns false. It exists as an explicit guard
 * so callers can write `if (!isToolLocked(name)) ...` and the lint
 * passes; the runtime answer is always "yes, locked".
 */
export function isToolLocked(_name: string): boolean {
  return true
}

/**
 * Can a tool be removed? Only if ALL of the following are true:
 *   1. It exists in the registry.
 *   2. It is NOT on the NEVER_REMOVABLE_TOOLS list.
 *   3. The owner has authorized the removal via cellphone / email /
 *      WhatsApp (verified by verifyOwnerAuthorization).
 *
 * If the owner authorization is missing or invalid, this returns
 * { allowed: false, reason: 'OWNER_AUTH_REQUIRED' } and the caller
 * MUST surface a request for authorization to the owner.
 */
export function canRemoveTool(
  name: string,
  authId?: string,
  authCode?: string
): { allowed: boolean; reason: string; authId?: string; waLink?: string } {
  if (!toolExists(name)) {
    return { allowed: false, reason: `TOOL_NOT_FOUND: "${name}" is not in the registry.` }
  }
  if (NEVER_REMOVABLE_TOOLS.includes(name)) {
    return {
      allowed: false,
      reason: `TOOL_NEVER_REMOVABLE: "${name}" is on the permanent protection list. ` +
        `This tool is required for the agent's autonomy and the owner's ability to recover. ` +
        `It cannot be removed under any circumstances — not even with owner authorization.`,
    }
  }
  if (!authId || !authCode) {
    return {
      allowed: false,
      reason: 'OWNER_AUTH_REQUIRED: Tool removal requires owner authorization via cellphone, email, or WhatsApp.',
    }
  }
  const verify = verifyOwnerAuthorization(authId, authCode)
  if (!verify.ok) {
    return { allowed: false, reason: `OWNER_AUTH_FAILED: ${verify.message}` }
  }
  return { allowed: true, reason: 'AUTHORIZED' }
}

/**
 * Async helper: start the owner-authorization flow for a tool removal.
 * Sends the 6-digit code to the owner via WhatsApp (primary), SMS, or
 * email. The owner must then call canRemoveTool(name, authId, code)
 * with the code they received.
 *
 * This is the ONLY entry point that triggers a tool-removal
 * authorization request.
 */
export async function requestToolRemovalAuthorization(
  toolName: string,
  preferredMethod?: 'whatsapp' | 'sms' | 'email' | 'totp'
): Promise<{
  ok: boolean
  authId: string
  message: string
  code?: string
  waLink?: string
  method?: string
}> {
  if (!toolExists(toolName)) {
    return { ok: false, authId: '', message: `Tool "${toolName}" not found in registry.` }
  }
  if (NEVER_REMOVABLE_TOOLS.includes(toolName)) {
    return {
      ok: false,
      authId: '',
      message: `Tool "${toolName}" is permanently protected and cannot be removed under any circumstances.`,
    }
  }
  // The operation name passed to owner-auth is "remove_tool:<name>" so
  // the owner's authorization record reflects exactly what they're
  // approving.
  return requestOwnerAuthorization(`remove_tool:${toolName}`, preferredMethod)
}

/**
 * Convenience wrapper: count all tools. Same as
 * `Object.keys(TOOL_REGISTRY).length` but exposed as a named function
 * for clarity in capabilities reports.
 */
export function countAllTools(): number {
  return Object.keys(TOOL_REGISTRY).length
}

/**
 * Convenience wrapper: count tools by category prefix.
 * Category is inferred from the tool name's prefix (e.g. "developer_",
 * "self_repair_", "trader_"). Tools with no underscore go in "core".
 */
export function countToolsByCategory(): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const name of Object.keys(TOOL_REGISTRY)) {
    const idx = name.indexOf('_')
    const cat = idx > 0 ? name.slice(0, idx) : 'core'
    counts[cat] = (counts[cat] ?? 0) + 1
  }
  return counts
}

/**
 * Re-export the owner-auth guards so callers can import everything
 * from one place.
 */
export {
  isOperationDisabled,
  requiresOwnerAuth,
  requestOwnerAuthorization,
  verifyOwnerAuthorization,
}
