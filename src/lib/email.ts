import nodemailer, { type Transporter } from 'nodemailer'
import { db } from '@/lib/db'
import { SEED_EMAIL } from '@/lib/auth'

/* ------------------------------------------------------------------ *
 * Email wrapper with multi-provider support.
 *
 * PRIORITY ORDER (first working provider wins):
 *   1. RESEND_API_KEY  → Resend.com HTTP API (Vercel-friendly, free tier)
 *      - Set RESEND_API_KEY = "re_xxx" (from https://resend.com/api-keys)
 *      - Set RESEND_FROM = "Agent007 <onboarding@resend.dev>" or your verified domain
 *      - Free tier: 100 emails/day, 3000/month
 *      - Works perfectly on Vercel (no SMTP basic-auth issues)
 *
 *   2. SMTP env vars (fallback — Microsoft has disabled basic auth for Outlook):
 *      SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 *      - For Gmail: use App Password (still works)
 *      - For Outlook/Hotmail: BROKEN (basic auth disabled by Microsoft)
 *
 *   3. Neither configured → log to console + DB (NotificationLog with sent=false)
 * ------------------------------------------------------------------ */

let transporter: Transporter | null = null
let transportReady = false

/**
 * Returns true if ANY email provider is configured.
 * Checks Resend first, then SMTP.
 */
export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY || !!(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASS)
}

/**
 * Returns true if Resend is the active provider.
 */
export function isResendConfigured(): boolean {
  return !!process.env.RESEND_API_KEY
}

/**
 * Send email via Resend.com HTTP API.
 * Resend is Vercel-friendly and doesn't have the basic-auth issues
 * that Microsoft Outlook/Hotmail now has.
 */
async function sendViaResend(opts: {
  to: string
  subject: string
  body: string
}): Promise<{ sent: boolean; message?: string; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY!
  const from = process.env.RESEND_FROM || 'Agent007 AI <onboarding@resend.dev>'

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [opts.to],
        subject: opts.subject,
        text: opts.body,
        html: bodyToHtml(opts.body, opts.subject),
      }),
      signal: AbortSignal.timeout(15000),
    })

    if (res.ok) {
      const data = await res.json().catch(() => ({}))
      return { sent: true, message: `id=${data.id ?? 'resend-ok'}` }
    } else {
      const errText = await res.text().catch(() => '')
      let errMsg = `Resend HTTP ${res.status}`
      try {
        const errJson = JSON.parse(errText)
        errMsg = `Resend: ${errJson.message || errText}`
      } catch {
        errMsg = `Resend HTTP ${res.status}: ${errText.slice(0, 200)}`
      }
      return { sent: false, error: errMsg }
    }
  } catch (e: any) {
    return { sent: false, error: `Resend fetch failed: ${e?.message ?? String(e)}` }
  }
}

function getTransporter(): Transporter | null {
  // If only Resend is configured (no SMTP), return null — Resend uses HTTP, not SMTP
  const hasSmtp = !!(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASS)
  if (!hasSmtp) return null
  if (transporter && transportReady) return transporter
  try {
    const port = parseInt(process.env.SMTP_PORT ?? '587', 10)
    const host = process.env.SMTP_HOST!
    const user = process.env.SMTP_USER!
    const pass = process.env.SMTP_PASS!

    const isOutlook = host.includes('outlook') || host.includes('hotmail') || host.includes('office365') || host.includes('live.com')

    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
      ...(isOutlook ? {
        tls: { ciphers: 'SSLv3', rejectUnauthorized: false },
        requireTLS: true,
      } : {}),
      connectionTimeout: 15000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    })
    transportReady = true
    return transporter
  } catch (e) {
    console.error('[email] Failed to create SMTP transporter:', e)
    transportReady = false
    return null
  }
}

export function defaultFrom(): string {
  if (process.env.RESEND_API_KEY) {
    return process.env.RESEND_FROM || 'Agent007 AI <onboarding@resend.dev>'
  }
  return process.env.SMTP_FROM ?? `Agent007 AI <noreply@${process.env.SMTP_HOST ?? 'localhost'}>`
}

export interface SendEmailResult {
  sent: boolean
  message?: string
  error?: string
}

/**
 * Send an email via the first available provider:
 *   1. Resend (if RESEND_API_KEY is set) — Vercel-friendly, no basic-auth issues
 *   2. SMTP (if configured) — fallback (may fail for Outlook/Hotmail)
 *   3. Neither → log to console + DB
 */
export async function sendEmail(opts: {
  to: string
  subject: string
  body: string
  userId?: string
  type?: string
}): Promise<SendEmailResult> {
  const { to, subject, body, userId, type } = opts
  const log = async (sent: boolean, msg?: string, err?: string) => {
    try {
      if (userId) {
        await db.notificationLog.create({
          data: { userId, type: type ?? 'mission_complete', to, subject, body, sent },
        })
      }
    } catch (dbErr) {
      console.error('[email] Failed to log notification:', dbErr)
    }
    if (sent) {
      console.log(`[email] SENT to="${to}" subject="${subject}" ${msg ?? ''}`)
    } else {
      console.log(`[email] LOGGED (not sent) to="${to}" subject="${subject}"`)
      if (err) console.log(`[email]   error: ${err}`)
    }
  }

  // ── PRIORITY 1: Resend (Vercel-friendly) ───────────────────────────
  if (process.env.RESEND_API_KEY) {
    const result = await sendViaResend({ to, subject, body })
    await log(result.sent, result.message, result.error)
    if (result.sent) return { sent: true, message: `Resend: ${result.message}` }
    // If Resend fails, fall through to SMTP (if configured)
    console.warn('[email] Resend failed, trying SMTP fallback:', result.error)
  }

  // ── PRIORITY 2: SMTP (fallback — may fail for Outlook) ─────────────
  const tx = getTransporter()
  if (tx) {
    try {
      const info = await tx.sendMail({
        from: defaultFrom(),
        to,
        subject,
        text: body,
        html: bodyToHtml(body, subject),
      })
      await log(true, `id=${info.messageId}`)
      return { sent: true, message: `SMTP: id=${info.messageId}` }
    } catch (e: any) {
      await log(false, undefined, e?.message ?? String(e))
      // Fall through to "not sent"
    }
  }

  // ── PRIORITY 3: Neither configured or both failed ──────────────────
  if (!process.env.RESEND_API_KEY && !tx) {
    await log(false, 'No email provider configured — logged only')
    return { sent: false, message: 'No email provider configured — logged only' }
  }

  return { sent: false, error: 'All email providers failed' }
}

function bodyToHtml(body: string, subject: string): string {
  const escaped = body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br/>')
  return `<!doctype html><html><body style="background:#05060a;color:#e0e7ff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:24px;">
  <div style="max-width:560px;margin:0 auto;border:1px solid rgba(0,240,255,0.25);border-radius:12px;overflow:hidden;background:rgba(8,10,22,0.95);">
    <div style="padding:18px 24px;background:linear-gradient(135deg,rgba(0,240,255,0.18),rgba(168,85,247,0.18));border-bottom:1px solid rgba(0,240,255,0.3);">
      <div style="font-size:18px;font-weight:700;color:#00f0ff;text-shadow:0 0 8px rgba(0,240,255,0.5);">Agent007 AI</div>
      <div style="font-size:11px;color:#7c89b5;letter-spacing:0.18em;text-transform:uppercase;margin-top:4px;">Income Operator</div>
    </div>
    <div style="padding:24px;">
      <h1 style="font-size:16px;color:#a855f7;margin:0 0 12px;font-weight:600;">${escapeHtml(subject)}</h1>
      <div style="font-size:14px;line-height:1.65;color:#cfd9f0;">${escaped}</div>
    </div>
    <div style="padding:14px 24px;border-top:1px solid rgba(0,240,255,0.12);font-size:11px;color:#5b6a92;">
      v2.0 • powered by Z.ai SDK • sent by Agent007 AI
    </div>
  </div>
</body></html>`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Resolve the single operator userId (the seeded user). Returns null if no
 * user is found.
 */
export async function getOperatorUserId(): Promise<string | null> {
  try {
    const u = await db.user.findUnique({ where: { email: SEED_EMAIL } })
    return u?.id ?? null
  } catch {
    return null
  }
}
