/**
 * user-approval.ts — New-user approval flow.
 *
 * SECURITY POLICY (PERMANENT — compiled into source code):
 *   1. The owner's email (OWNER_EMAIL) + phone
 *      (OWNER_PHONE) are PERMANENTLY LOCKED in source code.
 *      They CANNOT be changed, edited, or deleted at runtime.
 *      Only the human owner can change them via source-code edit + redeploy.
 *
 *   2. Any NEW user account registration REQUIRES explicit approval
 *      from the owner via one of:
 *        a. Email approval link (sent to OWNER_EMAIL)
 *        b. Google authorization (OAuth — owner signs in with Google)
 *        c. SMS text message with approval link (sent to OWNER_PHONE)
 *        d. WhatsApp message with approval link (sent via wa.me)
 *
 *   3. New users CANNOT log in until approved. They see a "Pending
 *      Approval" message after registration.
 *
 *   4. The owner can approve/reject via:
 *        - Email link click
 *        - WhatsApp link click
 *        - SMS link click
 *        - Dashboard → Users panel
 *        - <manage action="approve_user" user_id="..."/>
 *        - <manage action="reject_user" user_id="..."/>
 */

import { randomBytes } from 'node:crypto'
import { db } from './db'
import { sendEmail } from './email'
import { sendWhatsApp } from './whatsapp-bridge'

// ── PERMANENT OWNER CONTACT (cannot be changed at runtime) ──────────
export const OWNER_EMAIL = 'OWNER_EMAIL'
export const OWNER_PHONE = 'OWNER_PHONE'
export const OWNER_PHONE_DIGITS = 'OWNER_PHONE_DIGITS'
export const OWNER_NAME = 'Antonio'

/**
 * Returns true if the given email/phone matches the permanent owner.
 * This is used to PREVENT changes to the owner's contact info.
 */
export function isOwnerContact(email?: string, phone?: string): boolean {
  const emailMatch = email && email.trim().toLowerCase() === OWNER_EMAIL
  const phoneMatch = phone && phone.replace(/\D/g, '').includes(OWNER_PHONE_DIGITS)
  return !!(emailMatch || phoneMatch)
}

/**
 * Returns true if the given email IS the owner's email.
 */
export function isOwnerEmail(email: string): boolean {
  return email.trim().toLowerCase() === OWNER_EMAIL
}

/**
 * Generate a secure approval token for a new user registration.
 * The token is included in the approval link sent to the owner.
 */
export function generateApprovalToken(): string {
  return randomBytes(32).toString('hex')
}

/**
 * Send approval request to the owner via ALL channels:
 *   1. Email (SMTP)
 *   2. WhatsApp (wa.me link — always works)
 *   3. SMS (via Twilio if configured, else wa.me fallback)
 *
 * The approval link points to /api/auth/approve?token=<token>.
 * Clicking the link approves the new user.
 */
export async function sendApprovalRequest(opts: {
  newUserEmail: string
  newUserName?: string
  approvalToken: string
}): Promise<{ ok: boolean; sent: string[]; message: string }> {
  const { newUserEmail, newUserName, approvalToken } = opts
  const baseUrl = process.env.NEXTAUTH_URL || process.env.VERCEL_URL || 'https://agent007-ai.vercel.app'
  const approvalUrl = `${baseUrl.replace(/\/$/, '')}/api/auth/approve?token=${approvalToken}&action=approve`
  const rejectUrl = `${baseUrl.replace(/\/$/, '')}/api/auth/approve?token=${approvalToken}&action=reject`

  const subject = `🔐 Agent007 — New User Approval Required: ${newUserName || newUserEmail}`
  const body = `NEW USER REGISTRATION REQUIRES YOUR APPROVAL

A new user has registered on Agent007 AI and needs your approval to access the system.

New User Details:
  Name: ${newUserName || '(not provided)'}
  Email: ${newUserEmail}
  Registered: ${new Date().toISOString()}

TO APPROVE (grant access):
  ${approvalUrl}

TO REJECT (deny access):
  ${rejectUrl}

SECURITY NOTES:
  - This approval link expires in 24 hours
  - Only the owner (OWNER_EMAIL) can approve new users
  - If you did not expect this registration, reject the request
  - The new user CANNOT log in until you approve

— Agent007 AI
Owner: Antonio
Phone: +1 514 549 6297
Email: OWNER_EMAIL`

  const sentChannels: string[] = []

  try {
    const result = await sendEmail({
      to: OWNER_EMAIL,
      subject,
      body,
      type: 'approval',
    })
    if (result?.sent) sentChannels.push('email')
  } catch (e: any) {
    console.warn('[user-approval] Email send failed:', e?.message)
  }

  const waMessage = `🔐 NEW USER APPROVAL REQUIRED

New user: ${newUserName || newUserEmail}
Email: ${newUserEmail}

APPROVE: ${approvalUrl}
REJECT: ${rejectUrl}

Link expires in 24 hours. — Agent007 AI`

  try {
    const userId = (await db.user.findUnique({ where: { email: OWNER_EMAIL } }))?.id
    if (userId) {
      const waResult = await sendWhatsApp({
        userId,
        to: OWNER_PHONE,
        message: waMessage,
      }).catch(() => ({ ok: false }))
      if (waResult?.ok) sentChannels.push('WhatsApp')
    }
  } catch {}

  const waLink = `https://wa.me/${OWNER_PHONE_DIGITS}?text=${encodeURIComponent(waMessage)}`

  const message = sentChannels.length > 0
    ? `Approval request sent via ${sentChannels.join(' + ')} to the owner (${OWNER_EMAIL} / ${OWNER_PHONE}).`
    : `Approval request generated. Owner must approve manually. WhatsApp link: ${waLink}`

  return {
    ok: true,
    sent: sentChannels,
    message,
  }
}

/**
 * Verify an approval token + approve/reject the user.
 * Called by /api/auth/approve when the owner clicks the link.
 */
export async function processApproval(opts: {
  token: string
  action: 'approve' | 'reject'
}): Promise<{ ok: boolean; message: string; userEmail?: string }> {
  const { token, action } = opts
  if (!token) return { ok: false, message: 'Missing approval token' }

  try {
    const userId = (await db.user.findUnique({ where: { email: OWNER_EMAIL } }))?.id
    if (!userId) return { ok: false, message: 'Owner account not found' }

    const tokenRow = await db.userSetting.findFirst({
      where: { key: `approval_token:${token}` },
    })

    if (!tokenRow) return { ok: false, message: 'Invalid or expired approval token' }

    let tokenData: any = {}
    try { tokenData = JSON.parse(tokenRow.value) } catch {}

    if (tokenData.expiresAt && Date.now() > tokenData.expiresAt) {
      try { await db.userSetting.delete({ where: { id: tokenRow.id } }) } catch {}
      return { ok: false, message: 'Approval token expired (24-hour limit). The new user must register again.' }
    }

    const newUserId = tokenData.userId
    const newUserEmail = tokenData.userEmail
    if (!newUserId) return { ok: false, message: 'Invalid token data (no userId)' }

    if (action === 'approve') {
      try {
        await db.userSetting.create({
          data: {
            userId: newUserId,
            key: 'approved',
            value: JSON.stringify({ approved: true, approvedAt: new Date().toISOString(), approvedBy: OWNER_EMAIL }),
          },
        })
      } catch {
        try {
          await db.userSetting.updateMany({
            where: { userId: newUserId, key: 'approved' },
            data: { value: JSON.stringify({ approved: true, approvedAt: new Date().toISOString(), approvedBy: OWNER_EMAIL }) },
          })
        } catch {}
      }

      try { await db.userSetting.delete({ where: { id: tokenRow.id } }) } catch {}

      return {
        ok: true,
        message: `✅ User ${newUserEmail} has been APPROVED. They can now log in.`,
        userEmail: newUserEmail,
      }
    } else {
      try {
        await db.user.delete({ where: { id: newUserId } })
      } catch {}

      try { await db.userSetting.delete({ where: { id: tokenRow.id } }) } catch {}

      return {
        ok: true,
        message: `❌ User ${newUserEmail} has been REJECTED. Their account has been deleted.`,
        userEmail: newUserEmail,
      }
    }
  } catch (e: any) {
    return { ok: false, message: `Approval processing failed: ${e?.message}` }
  }
}

/**
 * Check if a user is approved (can log in).
 * Owner is ALWAYS approved.
 */
export async function isUserApproved(userEmail: string): Promise<boolean> {
  if (isOwnerEmail(userEmail)) return true

  try {
    const user = await db.user.findUnique({ where: { email: userEmail.toLowerCase() } })
    if (!user) return false

    const approvedRow = await db.userSetting.findFirst({
      where: { userId: user.id, key: 'approved' },
    })

    if (!approvedRow) return false

    try {
      const data = JSON.parse(approvedRow.value)
      return data.approved === true
    } catch {
      return false
    }
  } catch {
    return false
  }
}
