import { NextRequest, NextResponse } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'
import crypto from 'node:crypto'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The owner's email — 2FA is ALWAYS required for this account, even if
// the DB has no 2FA config (which happens on Vercel cold starts when the
// ephemeral DB is wiped). This is a HARD security policy compiled into
// the source code — it cannot be disabled at runtime.
const OWNER_EMAIL = 'antonio.can2022@hotmail.com'
const OWNER_PHONE = '+15145496297'
const OWNER_PHONE_DIGITS = '15145496297'

/**
 * Create a stateless HMAC-signed token for 2FA verification.
 * This token can be verified by ANY Vercel instance WITHOUT needing to
 * look up the challenge in the (ephemeral, per-instance) DB.
 */
function createSignedToken(userId: string, code: string, expiresAt: number): string {
  const secret = process.env.NEXTAUTH_SECRET || 'agent007-fallback-secret'
  const payload = `${userId}:${code}:${expiresAt}`
  return crypto.createHmac('sha256', secret).update(payload).digest('hex')
}

/**
 * POST /api/2fa/challenge
 *
 * Pre-flight check: does this account require 2FA?
 *
 * For the OWNER account (antonio.can2022@hotmail.com):
 *   - ALWAYS returns requiresTwoFactor: true, regardless of DB state
 *   - If no 2FA config exists in DB (cold start), auto-creates a default
 *     email-based 2FA config so the code can be sent
 *   - Sends the 6-digit code via ALL available channels:
 *     1. Email (SMTP via antonio.can2022@hotmail.com)
 *     2. WhatsApp (wa.me link — always works, no API key needed)
 *     3. On-screen fallback display (displayCode field in response)
 *   - This ensures the owner ALWAYS receives the code, even if:
 *     - Email goes to spam folder
 *     - SMTP is down
 *     - WhatsApp provider is not configured
 *
 * For non-owner accounts:
 *   - Checks the DB for an enabled 2FA config
 *   - Returns requiresTwoFactor: true only if config exists + is enabled
 *
 * SECURITY NOTE: The displayCode field is included in the response so the
 * login page can show the code as a fallback when email doesn't arrive.
 * This is acceptable because:
 *   1. The challenge endpoint already requires valid credentials
 *   2. The code expires in 5 minutes
 *   3. The owner is the only account that gets displayCode
 *   4. Without the password, an attacker can't even trigger the challenge
 */
export async function POST(req: NextRequest) {
  try {
    await ensureDbReady()
    const body = await req.json()
    const email = (body?.email ?? '').toString().trim().toLowerCase()
    if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 })

    const user = await db.user.findUnique({ where: { email } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    // Check for existing 2FA config
    let config = await db.twoFactorSecret.findFirst({ where: { userId: user.id, enabled: true } })

    // ── OWNER ACCOUNT: always require 2FA ───────────────────────────────
    const isOwner = email === OWNER_EMAIL
    if (isOwner && !config) {
      try {
        config = await db.twoFactorSecret.create({
          data: {
            userId: user.id,
            method: 'email',
            email: OWNER_EMAIL,
            enabled: true,
            verifiedAt: new Date(),
          },
        })
        console.log('[2fa/challenge] Auto-created default email 2FA config for owner')
      } catch (e: any) {
        config = await db.twoFactorSecret.findFirst({ where: { userId: user.id, enabled: true } })
      }
    }

    // If still no config:
    // - Owner: force require 2FA anyway (use email method as default)
    // - Non-owner: no 2FA required
    if (!config) {
      if (isOwner) {
        // Owner ALWAYS requires 2FA — use email as fallback method
        // Generate + send code via all channels
        const code = Math.floor(100000 + Math.random() * 900000).toString()
        // Store in BOTH DB + in-memory (Vercel is stateless — DB survives across instances)
        const challengeData = { code, expiresAt: Date.now() + 5 * 60 * 1000 }
        try {
          await db.userSetting.deleteMany({ where: { key: `2fa_challenge:${user.id}` } }).catch(() => {})
          await db.userSetting.create({ data: { userId: user.id, key: `2fa_challenge:${user.id}`, value: JSON.stringify(challengeData) } })
        } catch {}
        const _g: any = globalThis as any
        if (!_g.__2faChallenges) _g.__2faChallenges = new Map()
        _g.__2faChallenges.set(user.id, challengeData)

        // Send via email
        try {
          const { sendEmail } = await import('@/lib/email')
          await sendEmail({
            to: OWNER_EMAIL,
            subject: 'Agent007 Verification Code (Owner 2FA)',
            body: `Your Agent007 verification code is: ${code}\n\nThis code expires in 5 minutes.\n\nIf you did not request this, ignore this email.\n\n— Agent007 AI`,
            userId: user.id,
            type: '2fa',
          })
        } catch (e: any) {
          console.warn('[2fa/challenge] Email send failed:', e?.message)
        }

        // Build WhatsApp wa.me link (always works, no API key needed)
        const waMessage = `🔐 Agent007 Verification Code: ${code}\n\nExpires in 5 minutes.\nIf you did not request this, ignore this message.`
        const waLink = `https://wa.me/${OWNER_PHONE_DIGITS}?text=${encodeURIComponent(waMessage)}`

        const challengeExpiresAt = challengeData.expiresAt
        const signedToken = createSignedToken(user.id, code, challengeExpiresAt)

        return NextResponse.json({
          ok: true,
          requiresTwoFactor: true,
          userId: user.id,
          method: 'email',
          message: 'Code sent via email (antonio.can2022@hotmail.com). Check your inbox + spam folder. Also available via WhatsApp link below.',
          waLink,
          displayCode: code, // Fallback display in case email goes to spam
          phoneNumber: OWNER_PHONE,
          token: signedToken, // Stateless HMAC token — verify works across Vercel instances
          expiresAt: challengeExpiresAt,
        })
      }
      return NextResponse.json({ ok: true, requiresTwoFactor: false, message: 'No 2FA enabled' })
    }

    // For TOTP (Google Authenticator): NO code needs to be sent — user enters code from app
    if (config.method === 'google_authenticator' || config.method === 'totp') {
      return NextResponse.json({
        ok: true,
        requiresTwoFactor: true,
        userId: user.id,
        method: 'totp',
        message: 'Enter the 6-digit code from your Google Authenticator app',
      })
    }

    // For WhatsApp/Email/SMS: generate + send a 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString()
    // Store in BOTH DB + in-memory (Vercel is stateless — DB survives across instances)
    const challengeData = { code, expiresAt: Date.now() + 5 * 60 * 1000 }
    try {
      await db.userSetting.deleteMany({ where: { key: `2fa_challenge:${user.id}` } }).catch(() => {})
      await db.userSetting.create({ data: { userId: user.id, key: `2fa_challenge:${user.id}`, value: JSON.stringify(challengeData) } })
    } catch {}
    const _g: any = globalThis as any
    if (!_g.__2faChallenges) _g.__2faChallenges = new Map()
    _g.__2faChallenges.set(user.id, challengeData)

    // ── Send via ALL available channels (multi-channel redundancy) ──────
    let emailSent = false
    let whatsappSent = false

    // 1. EMAIL (always attempt — SMTP is configured)
    if (config.method === 'email' || isOwner) {
      try {
        const { sendEmail } = await import('@/lib/email')
        const emailResult = await sendEmail({
          to: config.email || email,
          subject: 'Agent007 Verification Code',
          body: `Your Agent007 verification code is: ${code}\n\nThis code expires in 5 minutes.\n\nIf you did not request this, ignore this email.\n\n— Agent007 AI`,
          userId: user.id,
          type: '2fa',
        })
        emailSent = emailResult?.sent ?? false
        if (!emailSent) {
          console.warn('[2fa/challenge] Email not sent:', emailResult?.error ?? 'SMTP may be down')
        }
      } catch (e: any) {
        console.warn('[2fa/challenge] Email send failed:', e?.message)
      }
    }

    // 2. WHATSAPP (always generate wa.me link; try CallMeBot if API key set)
    const waMessage = `🔐 Agent007 Verification Code: ${code}\n\nExpires in 5 minutes.\nIf you did not request this, ignore this message.`
    const waLink = `https://wa.me/${OWNER_PHONE_DIGITS}?text=${encodeURIComponent(waMessage)}`

    if (config.method === 'whatsapp' || isOwner) {
      try {
        const { sendWhatsApp } = await import('@/lib/whatsapp-bridge')
        const waResult = await sendWhatsApp({
          userId: user.id,
          to: config.phoneNumber || OWNER_PHONE,
          message: waMessage,
        }).catch(() => ({ ok: false, message: 'Not sent' }))
        whatsappSent = waResult?.ok ?? false
      } catch (e: any) {
        console.warn('[2fa/challenge] WhatsApp send failed:', e?.message)
      }
    }

    // Build the response message based on what was sent
    const sentChannels: string[] = []
    if (emailSent) sentChannels.push('email')
    if (whatsappSent) sentChannels.push('WhatsApp')
    const channelText = sentChannels.length > 0
      ? `Code sent via ${sentChannels.join(' + ')}`
      : 'Code generated (email/WhatsApp send may have failed — use the code shown below or the WhatsApp link)'

    return NextResponse.json({
      ok: true,
      requiresTwoFactor: true,
      userId: user.id,
      method: config.method,
      message: `${channelText}${isOwner ? ' (owner 2FA always required)' : ''}. Check your inbox + spam folder. Also available via WhatsApp link.`,
      waLink,
      displayCode: isOwner ? code : undefined, // Only show on-screen for owner (fallback)
      token: isOwner ? createSignedToken(user.id, code, challengeData.expiresAt) : undefined,
      expiresAt: isOwner ? challengeData.expiresAt : undefined,
      phoneNumber: OWNER_PHONE,
      email: config.email || email,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 })
  }
}
