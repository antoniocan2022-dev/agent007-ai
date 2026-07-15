/**
 * security-hardening.ts — Security hardening layer (upgrade #52)
 *
 * 5 features:
 *   1. Login rate limiting (5 attempts per IP per 15min, then email auth code required)
 *   2. CSRF token generation + verification
 *   3. Content-Security-Policy header helper
 *   4. API key encryption (AES-256 via Node crypto)
 *   5. Session timeout (24h auto-logout)
 */

import crypto from 'node:crypto'

// ─── 1. LOGIN RATE LIMITING ──────────────────────────────────────
interface LoginAttempt {
  ip: string
  email: string
  attempts: number
  firstAttemptAt: number
  lockedUntil: number | null
  authCode: string | null  // email-sent auth code after 5 failed attempts
  authCodeExpiresAt: number | null
}

const _g: any = globalThis as any
if (!_g.__loginAttempts) _g.__loginAttempts = new Map<string, LoginAttempt>()
const loginAttempts: Map<string, LoginAttempt> = _g.__loginAttempts

const MAX_LOGIN_ATTEMPTS = 5
const LOCKOUT_DURATION_MS = 15 * 60 * 1000  // 15 minutes
const AUTH_CODE_EXPIRY_MS = 10 * 60 * 1000   // 10 minutes
const WINDOW_MS = 15 * 60 * 1000              // 15-minute rolling window

/**
 * Get client IP from request (handles Vercel's x-forwarded-for)
 */
export function getClientIP(req: any): string {
  const forwarded = req?.headers?.['x-forwarded-for']
  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }
  const realIP = req?.headers?.['x-real-ip']
  if (realIP) return realIP
  return req?.socket?.remoteAddress || 'unknown'
}

/**
 * Check login attempt status for an IP + email combo.
 * Returns:
 *   - { allowed: true } if login is allowed
 *   - { allowed: false, reason: 'RATE_LIMITED', authCodeRequired: true } if 5+ failed attempts (must enter email auth code)
 *   - { allowed: false, reason: 'LOCKED_OUT', retryAfter: ms } if still in lockout period
 */
export function checkLoginAttempt(ip: string, email: string): {
  allowed: boolean
  reason?: string
  authCodeRequired?: boolean
  retryAfter?: number
  attemptsRemaining?: number
} {
  const key = `${ip}:${email.toLowerCase()}`
  const entry = loginAttempts.get(key)

  if (!entry) {
    return { allowed: true, attemptsRemaining: MAX_LOGIN_ATTEMPTS }
  }

  // Check if locked out
  if (entry.lockedUntil && Date.now() < entry.lockedUntil) {
    return {
      allowed: false,
      reason: 'LOCKED_OUT',
      retryAfter: entry.lockedUntil - Date.now(),
    }
  }

  // Check if auth code is required (5+ failed attempts)
  if (entry.attempts >= MAX_LOGIN_ATTEMPTS && entry.authCode) {
    if (entry.authCodeExpiresAt && Date.now() < entry.authCodeExpiresAt) {
      return {
        allowed: false,
        reason: 'RATE_LIMITED',
        authCodeRequired: true,
      }
    }
  }

  // Reset if window expired
  if (Date.now() - entry.firstAttemptAt > WINDOW_MS) {
    loginAttempts.delete(key)
    return { allowed: true, attemptsRemaining: MAX_LOGIN_ATTEMPTS }
  }

  return {
    allowed: true,
    attemptsRemaining: Math.max(0, MAX_LOGIN_ATTEMPTS - entry.attempts),
  }
}

/**
 * Record a failed login attempt. After 5 failures, generates an auth code
 * and returns it so the caller can email it to the owner.
 */
export function recordFailedLogin(ip: string, email: string): {
  authCodeRequired: boolean
  authCode?: string
  attemptsRemaining: number
} {
  const key = `${ip}:${email.toLowerCase()}`
  let entry = loginAttempts.get(key)

  if (!entry) {
    entry = {
      ip,
      email: email.toLowerCase(),
      attempts: 0,
      firstAttemptAt: Date.now(),
      lockedUntil: null,
      authCode: null,
      authCodeExpiresAt: null,
    }
    loginAttempts.set(key, entry)
  }

  entry.attempts++
  const attemptsRemaining = Math.max(0, MAX_LOGIN_ATTEMPTS - entry.attempts)

  // After 5 failed attempts: generate auth code + lock out
  if (entry.attempts >= MAX_LOGIN_ATTEMPTS) {
    entry.authCode = Math.floor(100000 + Math.random() * 900000).toString()
    entry.authCodeExpiresAt = Date.now() + AUTH_CODE_EXPIRY_MS
    entry.lockedUntil = Date.now() + LOCKOUT_DURATION_MS
    return {
      authCodeRequired: true,
      authCode: entry.authCode,
      attemptsRemaining: 0,
    }
  }

  return { authCodeRequired: false, attemptsRemaining }
}

/**
 * Verify the email auth code (sent after 5 failed attempts).
 * If correct, clears the lockout and allows login.
 */
export function verifyLoginAuthCode(ip: string, email: string, code: string): boolean {
  const key = `${ip}:${email.toLowerCase()}`
  const entry = loginAttempts.get(key)
  if (!entry || !entry.authCode) return false
  if (entry.authCode !== code) return false
  if (entry.authCodeExpiresAt && Date.now() > entry.authCodeExpiresAt) return false

  // Clear the lockout
  loginAttempts.delete(key)
  return true
}

/**
 * Clear login attempts on successful login.
 */
export function clearLoginAttempts(ip: string, email: string): void {
  const key = `${ip}:${email.toLowerCase()}`
  loginAttempts.delete(key)
}

// ─── 2. CSRF TOKEN ───────────────────────────────────────────────
const CSRF_SECRET = process.env.NEXTAUTH_SECRET || 'agent007-csrf-secret-2024'
const CSRF_TOKENS = new Map<string, number>()  // token → expiresAt
const CSRF_TOKEN_TTL = 60 * 60 * 1000  // 1 hour

/**
 * Generate a CSRF token for a session.
 */
export function generateCSRFToken(sessionId: string): string {
  const token = crypto.createHmac('sha256', CSRF_SECRET)
    .update(`${sessionId}:${Date.now()}:${Math.random()}`)
    .digest('hex')
  CSRF_TOKENS.set(token, Date.now() + CSRF_TOKEN_TTL)
  // Clean expired tokens
  for (const [t, expires] of CSRF_TOKENS) {
    if (Date.now() > expires) CSRF_TOKENS.delete(t)
  }
  return token
}

/**
 * Verify a CSRF token.
 */
export function verifyCSRFToken(token: string): boolean {
  const expires = CSRF_TOKENS.get(token)
  if (!expires) return false
  if (Date.now() > expires) {
    CSRF_TOKENS.delete(token)
    return false
  }
  return true
}

// ─── 3. CONTENT-SECURITY-POLICY ──────────────────────────────────
/**
 * Returns CSP header value for Next.js responses.
 */
export function getCSPHeader(): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://vercel.live",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https: blob:",
    "connect-src 'self' https://api.openai.com https://api.resend.com wss:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')
}

/**
 * Returns security headers object for Next.js responses.
 */
export function getSecurityHeaders(): Record<string, string> {
  return {
    'Content-Security-Policy': getCSPHeader(),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  }
}

// ─── 4. API KEY ENCRYPTION (AES-256) ─────────────────────────────
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.createHash('sha256').update(CSRF_SECRET).digest()
const IV_LENGTH = 16

/**
 * Encrypt an API key using AES-256-GCM.
 */
export function encryptAPIKey(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([iv, authTag, encrypted]).toString('base64')
}

/**
 * Decrypt an API key encrypted with encryptAPIKey.
 */
export function decryptAPIKey(ciphertext: string): string {
  try {
    const data = Buffer.from(ciphertext, 'base64')
    const iv = data.subarray(0, IV_LENGTH)
    const authTag = data.subarray(IV_LENGTH, IV_LENGTH + 16)
    const encrypted = data.subarray(IV_LENGTH + 16)
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv)
    decipher.setAuthTag(authTag)
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
    return decrypted.toString('utf8')
  } catch {
    // Fallback: maybe it's stored as plain text (old format)
    return ciphertext
  }
}

// ─── 5. SESSION TIMEOUT ──────────────────────────────────────────
const SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000  // 24 hours

/**
 * Check if a session has expired (24h timeout).
 */
export function isSessionExpired(sessionCreatedAt: number | undefined): boolean {
  if (!sessionCreatedAt) return false  // no creation time = don't expire
  return Date.now() - sessionCreatedAt > SESSION_TIMEOUT_MS
}

/**
 * Get session timeout in ms.
 */
export function getSessionTimeout(): number {
  return SESSION_TIMEOUT_MS
}
