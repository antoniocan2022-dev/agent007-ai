/**
 * owner-config.ts — UPGRADE #120
 * Centralized owner configuration — ALL PII reads from env vars.
 *
 * This replaces hardcoded email/phone across 20+ files.
 * Set these env vars in Vercel:
 *   OWNER_EMAIL — owner's email (default: operator@example.com for safety)
 *   OWNER_PHONE — owner's phone (default: empty)
 *   OWNER_PHONE_DIGITS — owner's phone digits only (default: empty)
 *   OWNER_NAME — owner's display name (default: "Owner")
 *
 * SECURITY: No PII is hardcoded in source code anymore.
 * All values come from environment variables.
 */

export const OWNER_EMAIL = process.env.OWNER_EMAIL || 'operator@example.com'
export const OWNER_PHONE = process.env.OWNER_PHONE || ''
export const OWNER_PHONE_DIGITS = process.env.OWNER_PHONE_DIGITS || (OWNER_PHONE.replace(/\D/g, ''))
export const OWNER_NAME = process.env.OWNER_NAME || 'Owner'

/**
 * The seed email used for the auto-created owner account.
 * In production, this should match OWNER_EMAIL.
 * During dev/testing, it can be overridden via SEED_EMAIL env var.
 */
export const SEED_EMAIL = process.env.SEED_EMAIL || OWNER_EMAIL

/**
 * Check if a given email belongs to the owner.
 */
export function isOwnerEmail(email: string | undefined | null): boolean {
  if (!email) return false
  return email.trim().toLowerCase() === OWNER_EMAIL.trim().toLowerCase()
}

/**
 * Get owner contact info as a formatted string for prompts/notifications.
 */
export function getOwnerContactString(): string {
  const parts = [OWNER_EMAIL]
  if (OWNER_PHONE) parts.push(OWNER_PHONE)
  return parts.join(', ')
}
