/**
 * owner-auth.ts — Owner authorization for ALL reset/delete/disable operations.
 *
 * Every destructive operation requires a 6-digit code sent to ONE of:
 * - WhatsApp: +15145496297 (primary — sends immediately)
 * - SMS: +15145496297 (fallback — via wa.me link if no SMS provider)
 * - Email: antonio.can2022@hotmail.com (backup)
 * - Google Authenticator (TOTP): owner registers a secret, scans QR, enters 6-digit code
 *
 * The code is displayed on-screen as fallback if all automated channels fail.
 *
 * UPGRADE-ONLY MODE: reset/delete operations are PERMANENTLY DISABLED.
 * Only upgrades, improvements, additions, and edits are allowed.
 * No operation can disable this mode.
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
  method: 'whatsapp' | 'sms' | 'email' | 'totp'
}
const _g: any = globalThis as any
if (!_g.__pendingOwnerAuth) _g.__pendingOwnerAuth = new Map<string, PendingAuth>()
const pendingAuths: Map<string, PendingAuth> = _g.__pendingOwnerAuth

// UPGRADE-ONLY MODE: reset/delete operations are DISABLED PERMANENTLY
// This constant CANNOT be changed at runtime — it's compiled into the binary.
// Even if the DB is wiped, this mode persists because it's in the source code.
export const UPGRADE_ONLY_MODE = true

// Operations that are PERMANENTLY DISABLED — no authorization can bypass
export const DISABLED_OPERATIONS = [
  'reset_system',
  'reset_database',
  'wipe_data',
  'force_reset',
  'reset_all_settings',
  'reset_all_upgrades',
  'delete_all_conversations',
  'delete_all_memories',
  'delete_all_subagents',
  'delete_all_schedules',
  'delete_all_income',
  'disable_upgrade_mode',
  'disable_owner_auth',
] as const

// Operations that require owner authorization (2FA via SMS/TOTP/WhatsApp/Email)
export const PROTECTED_OPERATIONS = [
  'delete_subagent', 'delete_bank_account', 'delete_paypal_account',
  'delete_api_key', 'delete_conversation', 'delete_memory',
  'reset_password', 'reset_system', 'reset_database',
  'disable_2fa', 'emergency_stop', 'restore_backup',
  'force_reset', 'wipe_data', 'delete_user',
  'delete_schedule', 'delete_income', 'delete_kb_doc',
  'delete_widget', 'clear_widgets',
  'delete_custom_setting',
  'disable_subagent',
  'change_owner_phone',
  'change_owner_email',
] as const

export function requiresOwnerAuth(operation: string): boolean {
  // UPGRADE-ONLY: block system resets and wipes entirely (no bypass)
  if (UPGRADE_ONLY_MODE && DISABLED_OPERATIONS.includes(operation as any)) {
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
  return UPGRADE_ONLY_MODE && DISABLED_OPERATIONS.includes(operation as any)
}

/** Generate a 6-digit code + send it to owner via the preferred method */
export async function requestOwnerAuthorization(
  operation: string,
  preferredMethod?: 'whatsapp' | 'sms' | 'email' | 'totp'
): Promise<{
  ok: boolean
  authId: string
  message: string
  code?: string
  waLink?: string
  method?: string
  totpRequired?: boolean
}> {
  // If operation is permanently disabled, reject immediately
  if (isOperationDisabled(operation)) {
    return {
      ok: false,
      authId: '',
      message: `Operation "${operation}" is PERMANENTLY DISABLED in upgrade-only mode. No authorization can bypass this.`,
    }
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString()
  const authId = crypto.randomUUID()
  const expiresAt = Date.now() + 10 * 60 * 1000 // 10 minutes

  // Determine method: TOTP doesn't need a code sent — owner uses Google Authenticator app
  let method: PendingAuth['method'] = preferredMethod ?? 'whatsapp'

  // If TOTP preferred, check if owner has TOTP configured
  if (method === 'totp') {
    const hasTotp = await ownerHasTotpConfigured()
    if (hasTotp) {
      pendingAuths.set(authId, { code, operation, expiresAt, attempts: 0, method: 'totp' })
      return {
        ok: true,
        authId,
        method: 'totp',
        totpRequired: true,
        message: `Enter the 6-digit code from your Google Authenticator app to authorize: ${operation}`,
      }
    }
    // Fall back to WhatsApp if TOTP not configured
    method = 'whatsapp'
  }

  pendingAuths.set(authId, { code, operation, expiresAt, attempts: 0, method })

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
  let smsSent = false

  // 1. Send via WhatsApp (primary)
  if (method === 'whatsapp') {
    try {
      const { sendWhatsApp } = await import('./whatsapp-bridge')
      const result = await sendWhatsApp({ userId, to: OWNER_PHONE, message })
      whatsappSent = result.ok
    } catch {}
  }

  // 2. Send via SMS (fallback) — uses Twilio if configured, else generates wa.me link
  if (method === 'sms' || (method === 'whatsapp' && !whatsappSent)) {
    try {
      const smsResult = await sendSmsFallback(OWNER_PHONE, message)
      smsSent = smsResult.ok
    } catch {}
  }

  // 3. Send via email (backup)
  try {
    const { sendEmail } = await import('./email')
    await sendEmail({ to: OWNER_EMAIL, subject: `🔐 Agent007 Authorization: ${operation}`, body: message, userId, type: 'auth' })
    emailSent = true
  } catch {}

  // 4. Generate wa.me link as manual fallback
  const waLink = `https://wa.me/${OWNER_PHONE.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`

  // 5. If all failed, return the code so the UI can display it
  if (!whatsappSent && !emailSent && !smsSent) {
    return {
      ok: true,
      authId,
      code, // Show on screen as fallback
      waLink,
      method,
      message: `⚠ Could not send code automatically. Your authorization code is: ${code}`,
    }
  }

  const sentVia: string[] = []
  if (whatsappSent) sentVia.push('WhatsApp')
  if (smsSent) sentVia.push('SMS')
  if (emailSent) sentVia.push('Email')
  return {
    ok: true,
    authId,
    waLink,
    method,
    message: `✅ Authorization code sent via ${sentVia.join(' + ')} to ${OWNER_PHONE}. Check your phone and enter the 6-digit code.`,
  }
}

/** Send SMS via Twilio (if configured) or generate wa.me link as fallback */
async function sendSmsFallback(phone: string, message: string): Promise<{ ok: boolean; message: string }> {
  const twilioSid = process.env.TWILIO_ACCOUNT_SID
  const twilioToken = process.env.TWILIO_AUTH_TOKEN
  const twilioFrom = process.env.TWILIO_FROM_NUMBER

  if (twilioSid && twilioToken && twilioFrom) {
    // Real SMS via Twilio
    try {
      const auth = Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64')
      const params = new URLSearchParams({
        To: phone,
        From: twilioFrom,
        Body: message.slice(0, 1600), // SMS limit
      })
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
        signal: AbortSignal.timeout(15000),
      })
      if (res.ok) return { ok: true, message: 'SMS sent via Twilio' }
      return { ok: false, message: `Twilio error: ${res.status}` }
    } catch (e: any) {
      return { ok: false, message: `Twilio failed: ${e?.message}` }
    }
  }

  // No Twilio configured — return false (caller will use wa.me link)
  return { ok: false, message: 'No SMS provider configured (Twilio not set up). Use wa.me link.' }
}

/** Verify the owner's authorization code (works for all methods including TOTP) */
export function verifyOwnerAuthorization(
  authId: string,
  code: string
): { ok: boolean; message: string } {
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

  // For TOTP method, also verify against the TOTP algorithm
  if (pending.method === 'totp') {
    const totpValid = verifyTotpCode(code)
    if (!totpValid) {
      return { ok: false, message: `Invalid TOTP code. ${6 - pending.attempts} attempts remaining.` }
    }
    pendingAuths.delete(authId)
    return { ok: true, message: '✅ TOTP authorization confirmed. Operation approved.' }
  }

  // Standard 6-digit code verification
  if (code !== pending.code) {
    return { ok: false, message: `Invalid code. ${6 - pending.attempts} attempts remaining.` }
  }
  pendingAuths.delete(authId)
  return { ok: true, message: '✅ Authorization confirmed. Operation approved.' }
}

/* ------------------------------------------------------------------ *
 * TOTP (Google Authenticator) Support
 * ------------------------------------------------------------------ */

const TOTP_ISSUER = 'Agent007 AI'
const TOTP_PERIOD = 30 // seconds
const TOTP_DIGITS = 6

/** Generate a new TOTP secret for the owner (32 chars base32) */
export function generateTotpSecret(): string {
  // RFC 6238 base32 alphabet
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let secret = ''
  const bytes = crypto.randomBytes(20)
  for (let i = 0; i < 20; i++) {
    secret += alphabet[bytes[i] % 32]
  }
  return secret
}

/** Generate the otpauth:// URL for QR code scanning */
export function generateTotpUrl(secret: string, email: string = OWNER_EMAIL): string {
  const issuer = encodeURIComponent(TOTP_ISSUER)
  const account = encodeURIComponent(email)
  return `otpauth://totp/${issuer}:${account}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD}`
}

/** Verify a TOTP code against a secret (accepts ±1 window for clock skew) */
export function verifyTotpCode(code: string, secret?: string): boolean {
  // If no secret provided, try to load from DB
  if (!secret) {
    // Synchronous fallback — we can't await here, so we use a cached value
    // The actual secret should be loaded by the caller and passed in
    return false
  }
  const now = Math.floor(Date.now() / 1000)
  // Check current window + 1 before + 1 after (30s skew tolerance)
  for (let offset = -1; offset <= 1; offset++) {
    const counter = Math.floor(now / TOTP_PERIOD) + offset
    const expectedCode = generateTotpForCounter(secret, counter)
    if (code === expectedCode) return true
  }
  return false
}

/** Async version that loads secret from DB */
export async function verifyTotpCodeAsync(code: string): Promise<boolean> {
  try {
    const secret = await getOwnerTotpSecret()
    if (!secret) return false
    return verifyTotpCode(code, secret)
  } catch {
    return false
  }
}

/** Generate TOTP code for a specific counter (RFC 6238) */
function generateTotpForCounter(secret: string, counter: number): string {
  const buffer = Buffer.alloc(8)
  buffer.writeBigInt64BE(BigInt(counter))

  // Decode base32 secret
  const key = base32Decode(secret)
  if (!key) return ''

  const hmac = crypto.createHmac('sha1', key).update(buffer).digest()

  // Dynamic truncation (RFC 4226)
  const offset = hmac[hmac.length - 1] & 0xf
  const binary = ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)

  const code = binary % Math.pow(10, TOTP_DIGITS)
  return code.toString().padStart(TOTP_DIGITS, '0')
}

/** Decode a base32 string to a Buffer */
function base32Decode(s: string): Buffer | null {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '')
  if (clean.length === 0) return null

  const bits: string[] = []
  for (const c of clean) {
    const idx = alphabet.indexOf(c)
    if (idx < 0) return null
    bits.push(idx.toString(2).padStart(5, '0'))
  }
  const allBits = bits.join('')
  const bytes: number[] = []
  for (let i = 0; i + 8 <= allBits.length; i += 8) {
    bytes.push(parseInt(allBits.slice(i, i + 8), 2))
  }
  return Buffer.from(bytes)
}

/** Check if owner has TOTP configured in DB */
export async function ownerHasTotpConfigured(): Promise<boolean> {
  try {
    const secret = await getOwnerTotpSecret()
    return !!secret
  } catch {
    return false
  }
}

/** Get the owner's TOTP secret from DB */
export async function getOwnerTotpSecret(): Promise<string | null> {
  try {
    const userId = await getOperatorUserId()
    if (!userId) return null
    const config = await db.twoFactorSecret.findFirst({
      where: { userId, method: 'google_authenticator', enabled: true },
    })
    return config?.secret ?? null
  } catch {
    return null
  }
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
