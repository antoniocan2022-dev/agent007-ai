import { NextResponse } from 'next/server'
import { isEmailConfigured, isResendConfigured, sendEmail } from '@/lib/email'
import { db, ensureDbReady } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/system/diagnose-email
 *
 * Diagnoses why authentication emails might not be arriving.
 * The test message is sent to the actual seeded owner account email — never
 * to a literal placeholder string such as "OWNER_EMAIL".
 */
export async function GET() {
  try {
    await ensureDbReady()

    const resendConfigured = isResendConfigured()
    const smtpConfigured = !!(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASS)
    const overallConfigured = isEmailConfigured()
    const owner = await db.user.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true, email: true } })
    const testRecipient = owner?.email ?? ''

    const smtpHost = process.env.SMTP_HOST ?? '(not set)'
    const smtpPort = process.env.SMTP_PORT ?? '(not set)'
    const smtpUser = process.env.SMTP_USER ?? '(not set)'
    const smtpFrom = process.env.SMTP_FROM ?? '(not set)'
    const hasSmtpPassword = !!process.env.SMTP_PASS
    const resendFrom = process.env.RESEND_FROM ?? 'Agent007 AI <onboarding@resend.dev>'
    const hasResendKey = !!process.env.RESEND_API_KEY

    let sendResult: any = { attempted: false }
    if (overallConfigured && testRecipient) {
      try {
        const r = await sendEmail({
          to: testRecipient,
          subject: 'Agent007 Email Diagnostic Test',
          body: `This is a diagnostic test email from Agent007 AI.\n\nSent at: ${new Date().toISOString()}\n\nEmail Provider: ${resendConfigured ? 'Resend.com' : 'SMTP'}\n${resendConfigured ? `Resend From: ${resendFrom}` : `SMTP Host: ${smtpHost}\nSMTP Port: ${smtpPort}\nSMTP User: ${smtpUser}\nSMTP From: ${smtpFrom}`}\n\nIf you received this email, email delivery is working correctly!\n\n— Agent007 AI`,
          userId: owner?.id,
          type: 'diagnostic',
        })
        sendResult = { attempted: true, sent: r.sent, error: r.error, message: r.message, provider: resendConfigured ? 'Resend' : 'SMTP' }
      } catch (e: any) {
        sendResult = { attempted: true, sent: false, error: e?.message }
      }
    } else if (overallConfigured && !testRecipient) {
      sendResult = { attempted: false, sent: false, error: 'No owner account exists to test email delivery.' }
    }

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      provider: resendConfigured ? 'resend' : smtpConfigured ? 'smtp' : 'none',
      testRecipientConfigured: !!testRecipient,
      testRecipientMasked: testRecipient ? `${testRecipient.slice(0, 2)}***${testRecipient.includes('@') ? testRecipient.slice(testRecipient.indexOf('@')) : ''}` : null,
      resend: { configured: resendConfigured, hasApiKey: hasResendKey, from: resendFrom },
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
            'Resend is configured. The diagnostic now sends to the real owner account email.',
            'If onboarding@resend.dev rejects the recipient, verify the recipient email in the Resend account or configure RESEND_FROM with a verified domain.',
            'Outlook basic SMTP authentication is not a valid production fallback; use Resend with a verified sender domain.',
          ]
        : [
            'Resend not configured. Set RESEND_API_KEY in Vercel and configure RESEND_FROM with a verified sender when sending outside the Resend test recipient.',
          ],
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 })
  }
}
