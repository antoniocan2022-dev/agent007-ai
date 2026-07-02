/**
 * owner-auth.ts — Owner authorization for ALL reset/delete operations.
 * 
 * Every destructive operation requires a 6-digit code sent to:
 * - WhatsApp: +15145496297 (primary — sends immediately)
 * - Email: antonio.can2022@hotmail.com (backup)
 * 
 * The code is displayed on-screen as fallback if WhatsApp fails.
 */
import { db } from './db'
import crypto from 'node:crypto'

const OWNER_PHONE = '+15145496297'
const OWNER_EMAIL = 'antonio.can2022@hotmail.com'

interface PendingAuth {
  code: string
  operation: string
  expiresAt: number
  attempts: number
}
const _g: any = globalThis as any
if (!_g.__pendingOwnerAuth) _g.__pendingOwnerAuth = new Map<string, PendingAuth>()
const pendingAuths: Map<string, PendingAuth> = _g.__pendingOwnerAuth

// UPGRADE-ONLY MODE: reset/delete operations are DISABLED
// Only upgrades, improvements, and additions are allowed
export const UPGRADE_ONLY_MODE = true
export const DISABLED_OPERATIONS = [
  'reset_system',
  'reset_database', 
  'wipe_data',
  'force_reset',
]

export const PROTECTED_OPERATIONS = [
  'delete_subagent', 'delete_bank_account', 'delete_paypal_account',
  'delete_api_key', 'delete_conversation', 'delete_memory',
  'reset_password', 'reset_system', 'reset_database',
  'disable_2fa', 'emergency_stop', 'restore_backup',
  'force_reset', 'wipe_data', 'delete_user',
  'delete_schedule', 'delete_income', 'delete_kb_doc',
] as const

export function requiresOwnerAuth(operation: string): boolean {
  // UPGRADE-ONLY: block system resets and wipes entirely
  if (UPGRADE_ONLY_MODE && DISABLED_OPERATIONS.includes(operation)) {
    return false // Don't even request auth — just block
  }
  return PROTECTED_OPERATIONS.includes(operation as any) ||
    operation.startsWith('delete_') ||
    operation.startsWith('reset_') ||
    operation.startsWith('disable_') ||
    operation.startsWith('wipe_')
}

// Check if an operation is PERMANENTLY DISABLED (upgrade-only mode)
export function isOperationDisabled(operation: string): boolean {
  return UPGRADE_ONLY_MODE && DISABLED_OPERATIONS.includes(operation)
}

/** Generate a 6-digit code + send it to owner's phone via WhatsApp */
export async function requestOwnerAuthorization(operation: string): Promise<{ ok: boolean; authId: string; message: string; code?: string; waLink?: string }> {
  const code = Math.floor(100000 + Math.random() * 900000).toString()
  const authId = crypto.randomUUID()
  const expiresAt = Date.now() + 10 * 60 * 1000 // 10 minutes

  pendingAuths.set(authId, { code, operation, expiresAt, attempts: 0 })

  const userId = await getOperatorUserId()
  if (!userId) return { ok: false, authId: '', message: 'No operator user found' }

  const message = `🔐 AGENT007 AUTHORIZATION REQUIRED

Operation: ${operation}
Code: ${code}

This code expires in 10 minutes.
Enter this code on the screen to authorize the operation.

If you did NOT request this, ignore this message.

— Agent007 AI`

  let whatsappSent = false
  let emailSent = false

  // 1. Send via WhatsApp (primary)
  try {
    const { sendWhatsApp } = await import('./whatsapp-bridge')
    const result = await sendWhatsApp({ userId, to: OWNER_PHONE, message })
    whatsappSent = result.ok
  } catch {}

  // 2. Send via email (backup)
  try {
    const { sendEmail } = await import('./email')
    await sendEmail({ to: OWNER_EMAIL, subject: `🔐 Agent007 Authorization: ${operation}`, body: message, userId, type: 'auth' })
    emailSent = true
  } catch {}

  // 3. Generate wa.me link as manual fallback
  const waLink = `https://wa.me/${OWNER_PHONE.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`

  // 4. If both failed, return the code so the UI can display it
  if (!whatsappSent && !emailSent) {
    return {
      ok: true,
      authId,
      code, // Show on screen as fallback
      waLink,
      message: `⚠ Could not send code automatically. Your authorization code is: ${code}`,
    }
  }

  const sentVia = whatsappSent && emailSent ? 'WhatsApp + Email' : whatsappSent ? 'WhatsApp' : 'Email'
  return {
    ok: true,
    authId,
    waLink,
    message: `✅ Authorization code sent via ${sentVia} to ${OWNER_PHONE}. Check your phone and enter the 6-digit code.`,
  }
}

/** Verify the owner's authorization code */
export function verifyOwnerAuthorization(authId: string, code: string): { ok: boolean; message: string } {
  const pending = pendingAuths.get(authId)
  if (!pending) return { ok: false, message: 'No pending authorization. Request a new code.' }
  if (Date.now() > pending.expiresAt) {
    pendingAuths.delete(authId)
    return { ok: false, message: 'Code expired. Request a new code.' }
  }
  pending.attempts++
  if (pending.attempts > 5) {
    pendingAuths.delete(authId)
    return { ok: false, message: 'Too many failed attempts. Request a new code.' }
  }
  if (code !== pending.code) {
    return { ok: false, message: `Invalid code. ${6 - pending.attempts} attempts remaining.` }
  }
  pendingAuths.delete(authId)
  return { ok: true, message: '✅ Authorization confirmed. Operation approved.' }
}

/** Check if a phone/email is the authorized owner */
export function isAuthorizedOwner(contact: string): boolean {
  const normalized = contact.replace(/\D/g, '')
  const ownerNormalized = OWNER_PHONE.replace(/\D/g, '')
  return normalized.includes(ownerNormalized) || ownerNormalized.includes(normalized)
}

async function getOperatorUserId() {
  const u = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
  return u?.id ?? null
}
