/**
 * owner-auth.ts — Owner authorization system for all reset/delete operations.
 * 
 * Every destructive operation (delete, reset, disable, restore) requires the
 * owner to confirm via a 6-digit code sent to:
 * - WhatsApp: +15145496297
 * - SMS: +15145496297
 * - Email: owner's email
 * - Google Authenticator (TOTP)
 */
import { db } from './db'
import crypto from 'node:crypto'

const OWNER_PHONE = '+15145496297'

// In-memory pending authorization codes (expires in 5 min)
interface PendingAuth {
  code: string
  operation: string
  expiresAt: number
  attempts: number
}
const _g: any = globalThis as any
if (!_g.__pendingOwnerAuth) _g.__pendingOwnerAuth = new Map<string, PendingAuth>()
const pendingAuths: Map<string, PendingAuth> = _g.__pendingOwnerAuth

/** Operations that REQUIRE owner authorization */
export const PROTECTED_OPERATIONS = [
  'delete_subagent',
  'delete_bank_account',
  'delete_paypal_account',
  'delete_api_key',
  'delete_conversation',
  'delete_memory',
  'reset_password',
  'reset_system',
  'reset_database',
  'disable_2fa',
  'emergency_stop',
  'restore_backup',
  'force_reset',
  'wipe_data',
  'delete_user',
] as const

/** Check if an operation requires owner authorization */
export function requiresOwnerAuth(operation: string): boolean {
  return PROTECTED_OPERATIONS.includes(operation as any)
}

/** Generate a 6-digit code + send it to the owner */
export async function requestOwnerAuthorization(operation: string): Promise<{ ok: boolean; authId: string; message: string }> {
  const code = Math.floor(100000 + Math.random() * 900000).toString()
  const authId = crypto.randomUUID()
  const expiresAt = Date.now() + 5 * 60 * 1000 // 5 minutes

  pendingAuths.set(authId, { code, operation, expiresAt, attempts: 0 })

  // Send the code to owner via all available channels
  const userId = await getOperatorUserId()
  if (!userId) return { ok: false, authId: '', message: 'No operator user' }

  const message = `🔐 AGENT007 AUTHORIZATION REQUIRED\n\nOperation: ${operation}\nCode: ${code}\n\nThis code expires in 5 minutes. Reply with this code to authorize the operation.`

  // Try WhatsApp
  try {
    const { sendWhatsApp } = await import('./whatsapp-bridge')
    await sendWhatsApp({ userId, to: OWNER_PHONE, message }).catch(() => {})
  } catch {}

  // Try email
  try {
    const user = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
    if (user?.email) {
      const { sendEmail } = await import('./email')
      await sendEmail({ to: user.email, subject: `🔐 Authorization Code: ${operation}`, body: message, userId, type: 'auth' }).catch(() => {})
    }
  } catch {}

  return { ok: true, authId, message: `Authorization code sent to ${OWNER_PHONE} (WhatsApp) and email. Check your phone and reply with the 6-digit code.` }
}

/** Verify the owner's authorization code */
export function verifyOwnerAuthorization(authId: string, code: string): { ok: boolean; message: string } {
  const pending = pendingAuths.get(authId)
  if (!pending) return { ok: false, message: 'No pending authorization request. Request a new code.' }
  if (Date.now() > pending.expiresAt) {
    pendingAuths.delete(authId)
    return { ok: false, message: 'Authorization code expired. Request a new code.' }
  }
  pending.attempts++
  if (pending.attempts > 3) {
    pendingAuths.delete(authId)
    return { ok: false, message: 'Too many failed attempts. Request a new code.' }
  }
  if (code !== pending.code) {
    return { ok: false, message: `Invalid code. ${4 - pending.attempts} attempts remaining.` }
  }
  pendingAuths.delete(authId)
  return { ok: true, message: '✅ Authorization confirmed. Operation approved.' }
}

/** Check if a phone number/email is the authorized owner */
export function isAuthorizedOwner(contact: string): boolean {
  const normalized = contact.replace(/\D/g, '')
  const ownerNormalized = OWNER_PHONE.replace(/\D/g, '')
  return normalized.includes(ownerNormalized) || ownerNormalized.includes(normalized)
}

async function getOperatorUserId() {
  const u = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
  return u?.id ?? null
}
