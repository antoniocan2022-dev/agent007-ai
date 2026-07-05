import { NextRequest, NextResponse } from 'next/server'
import { isEmailConfigured, sendEmail } from '@/lib/email'
import { db, ensureDbReady } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/system/diagnose-email
 *
 * Diagnoses why 2FA emails might not be arriving.
 * Returns SMTP config + sends a test email + reports the result.
 */
export async function GET() {
  try {
    await ensureDbReady()
    const configured = isEmailConfigured()
    const smtpHost = process.env.SMTP_HOST ?? '(not set)'
    const smtpPort = process.env.SMTP_PORT ?? '(not set)'
    const smtpUser = process.env.SMTP_USER ?? '(not set)'
    const smtpFrom = process.env.SMTP_FROM ?? '(not set)'
    const hasPassword = !!process.env.SMTP_PASS

    // Try sending a test email
    let sendResult: any = { attempted: false }
    if (configured) {
      try {
        const userId = (await db.user.findFirst({ orderBy: { createdAt: 'asc' } }))?.id
        const r = await sendEmail({
          to: 'antonio.can2022@hotmail.com',
          subject: 'Agent007 Email Diagnostic Test',
          body: `This is a diagnostic test email from Agent007 AI.\n\nSent at: ${new Date().toISOString()}\nSMTP Host: ${smtpHost}\nSMTP Port: ${smtpPort}\nSMTP User: ${smtpUser}\nSMTP From: ${smtpFrom}\n\nIf you received this email, SMTP is working correctly.\nIf you did NOT receive this email, check:\n1. Spam/junk folder\n2. Outlook/Hotmail may be blocking automated emails\n3. SMTP credentials (app password vs regular password)\n4. SMTP_FROM must match SMTP_USER for Outlook\n\n— Agent007 AI`,
          userId: userId ?? '',
          type: 'diagnostic',
        })
        sendResult = { attempted: true, sent: r.sent, error: r.error, message: r.message }
      } catch (e: any) {
        sendResult = { attempted: true, sent: false, error: e?.message }
      }
    }

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      smtp: {
        configured,
        host: smtpHost,
        port: smtpPort,
        user: smtpUser,
        from: smtpFrom,
        hasPassword,
        isOutlook: smtpHost.includes('outlook') || smtpHost.includes('hotmail'),
      },
      sendResult,
      recommendations: [
        'Check spam/junk folder for emails from ' + smtpFrom,
        'For Outlook/Hotmail: use an App Password, not your regular password',
        'SMTP_FROM should match SMTP_USER for Outlook',
        'If emails still don\'t arrive: the on-screen FALLBACK CODE always works',
        'WhatsApp wa.me link is always available as an alternative',
      ],
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 })
  }
}
