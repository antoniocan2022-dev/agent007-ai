import { NextRequest, NextResponse } from 'next/server'
import { isEmailConfigured, isResendConfigured, sendEmail } from '@/lib/email'
import { db, ensureDbReady } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/system/diagnose-email
 *
 * Diagnoses why 2FA emails might not be arriving.
 * Returns Resend + SMTP config + sends a test email + reports the result.
 */
export async function GET() {
  try {
    await ensureDbReady()

    const resendConfigured = isResendConfigured()
    const smtpConfigured = !!(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASS)
    const overallConfigured = isEmailConfigured()

    const smtpHost = process.env.SMTP_HOST ?? '(not set)'
    const smtpPort = process.env.SMTP_PORT ?? '(not set)'
    const smtpUser = process.env.SMTP_USER ?? '(not set)'
    const smtpFrom = process.env.SMTP_FROM ?? '(not set)'
    const hasSmtpPassword = !!process.env.SMTP_PASS

    const resendFrom = process.env.RESEND_FROM ?? 'Agent007 AI <onboarding@resend.dev>'
    const hasResendKey = !!process.env.RESEND_API_KEY

    // Try sending a test email
    let sendResult: any = { attempted: false }
    if (overallConfigured) {
      try {
        const userId = (await db.user.findFirst({ orderBy: { createdAt: 'asc' } }))?.id
        const r = await sendEmail({
          to: 'OWNER_EMAIL',
          subject: 'Agent007 Email Diagnostic Test',
          body: `This is a diagnostic test email from Agent007 AI.\n\nSent at: ${new Date().toISOString()}\n\nEmail Provider: ${resendConfigured ? 'Resend.com' : 'SMTP'}\n${resendConfigured ? `Resend From: ${resendFrom}` : `SMTP Host: ${smtpHost}\nSMTP Port: ${smtpPort}\nSMTP User: ${smtpUser}\nSMTP From: ${smtpFrom}`}\n\nIf you received this email, email delivery is working correctly!\n\n— Agent007 AI`,
          userId: userId ?? '',
          type: 'diagnostic',
        })
        sendResult = { attempted: true, sent: r.sent, error: r.error, message: r.message, provider: resendConfigured ? 'Resend' : 'SMTP' }
      } catch (e: any) {
        sendResult = { attempted: true, sent: false, error: e?.message }
      }
    }

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      provider: resendConfigured ? 'resend' : smtpConfigured ? 'smtp' : 'none',
      resend: {
        configured: resendConfigured,
        hasApiKey: hasResendKey,
        from: resendFrom,
      },
      smtp: {
        configured: smtpConfigured,
        host: smtpHost,
        port: smtpPort,
        user: smtpUser,
        from: smtpFrom,
        hasPassword: hasSmtpPassword,
        isOutlook: smtpHost.includes('outlook') || smtpHost.includes('hotmail'),
      },
      sendResult,
      recommendations: resendConfigured
        ? [
            'Resend is configured! Check your inbox at OWNER_EMAIL',
            'If using onboarding@resend.dev, you can ONLY send to the email you signed up with',
            'To send to any address: verify your own domain in Resend dashboard',
          ]
        : [
            'Resend not configured. To fix email delivery:',
            '1. Sign up at https://resend.com (free)',
            '2. Get API key from https://resend.com/api-keys',
            '3. Set RESEND_API_KEY env var in Vercel',
            '4. (Optional) Set RESEND_FROM to your verified domain',
            '5. Redeploy',
            '',
            'Note: The on-screen FALLBACK CODE always works for login',
            'Note: WhatsApp wa.me link is always available',
          ],
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 })
  }
}
