import nodemailer, { type Transporter } from 'nodemailer'
import { db } from '@/lib/db'
import { SEED_EMAIL } from '@/lib/auth'

/* ------------------------------------------------------------------ *
 * Email wrapper around Nodemailer.
 *
 * SMTP env vars (all optional — if unset, the email is logged to console
 * and stored in NotificationLog with sent=false instead of being sent):
 *   SMTP_HOST     e.g. "smtp.gmail.com"
 *   SMTP_PORT     e.g. 587
 *   SMTP_USER     username
 *   SMTP_PASS     password / app password
 *   SMTP_FROM     "Agent007 AI <noreply@yourdomain.com>"
 * ------------------------------------------------------------------ */

let transporter: Transporter | null = null
let transportReady = false

export function isEmailConfigured(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASS)
}

function getTransporter(): Transporter | null {
  if (!isEmailConfigured()) return null
  if (transporter && transportReady) return transporter
  try {
    const port = parseInt(process.env.SMTP_PORT ?? '587', 10)
    const host = process.env.SMTP_HOST!
    const user = process.env.SMTP_USER!
    const pass = process.env.SMTP_PASS!

    // Detect Outlook/Hotmail and use OAuth2-compatible settings
    // Microsoft disabled basic auth — requires App Password or OAuth2
    const isOutlook = host.includes('outlook') || host.includes('hotmail') || host.includes('office365') || host.includes('live.com')

    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: {
        user,
        pass,
      },
      // For Outlook, add additional settings to work around basic auth deprecation
      ...(isOutlook ? {
        tls: {
          ciphers: 'SSLv3',
          rejectUnauthorized: false,
        },
        requireTLS: true,
      } : {}),
      // Increase timeout for slow SMTP servers
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
  return process.env.SMTP_FROM ?? `Agent007 AI <noreply@${process.env.SMTP_HOST ?? 'localhost'}>`
}

export interface SendEmailResult {
  sent: boolean
  message?: string
  error?: string
}

/**
 * Send an email (or, if SMTP env vars are missing, log it to console + DB
 * NotificationLog row with sent=false). Always returns gracefully so callers
 * can fire-and-forget without try/catch.
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
          data: {
            userId,
            type: type ?? 'mission_complete',
            to,
            subject,
            body,
            sent,
          },
        })
      }
    } catch (dbErr) {
      console.error('[email] Failed to log notification:', dbErr)
    }
    if (sent) {
      console.log(`[email] SENT to="${to}" subject="${subject}" ${msg ?? ''}`)
    } else {
      console.log(`[email] LOGGED (SMTP not configured) to="${to}" subject="${subject}"`)
      console.log(`[email]   body preview: ${body.slice(0, 280)}...`)
      if (err) console.log(`[email]   error: ${err}`)
    }
  }

  const tx = getTransporter()
  if (!tx) {
    await log(false, 'SMTP not configured — logged only')
    return { sent: false, message: 'SMTP not configured — logged only' }
  }
  try {
    const info = await tx.sendMail({
      from: defaultFrom(),
      to,
      subject,
      text: body,
      html: bodyToHtml(body, subject),
    })
    await log(true, `id=${info.messageId}`)
    return { sent: true, message: `id=${info.messageId}` }
  } catch (e: any) {
    await log(false, undefined, e?.message ?? String(e))
    return { sent: false, error: e?.message ?? String(e) }
  }
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
