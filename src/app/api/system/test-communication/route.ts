import { NextResponse } from 'next/server'
import { isEmailConfigured, sendEmail } from '@/lib/email'
import { db } from '@/lib/db'
import { generateWaLink, sendViaCallmebot, sendWhatsApp } from '@/lib/whatsapp-bridge'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/system/test-communication
 *
 * Tests all configured communication channels and returns a structured
 * pass/fail report for each.
 *
 * Body: { email?: boolean, whatsapp?: 'wa_link' | 'callmebot' | 'baileys', phone?: string, sms?: boolean }
 * Default: test all configured channels.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const { email: testEmail, whatsapp: waProvider, phone, sms: testSms } = body as {
    email?: boolean
    whatsapp?: 'wa_link' | 'callmebot' | 'baileys'
    phone?: string
    sms?: boolean
  }

  const results: Array<{ channel: string; status: 'pass' | 'fail' | 'warn'; detail: string; timestamp: string }> = []
  const ts = () => new Date().toISOString()

  /* ----- Email test ----- */
  if (testEmail !== false) {
    if (!isEmailConfigured()) {
      results.push({
        channel: 'email',
        status: 'warn',
        detail: 'SMTP not configured (SMTP_HOST/PORT/USER/PASS env vars missing)',
        timestamp: ts(),
      })
    } else {
      try {
        const target = 'antonio.can2022@hotmail.com'
        const r = await sendEmail({
          to: target,
          subject: 'Agent007 Communication Test',
          body: `This is a test email from Agent007 AI sent at ${new Date().toISOString()}.\n\nIf you received this, email communication is working correctly.\n\n- Agent007 AI`,
          type: 'comm_test',
        })
        if (r.sent) {
          results.push({
            channel: 'email',
            status: 'pass',
            detail: `Test email sent to ${target} (messageId: ${r.message})`,
            timestamp: ts(),
          })
        } else {
          results.push({
            channel: 'email',
            status: 'fail',
            detail: `SMTP configured but send failed: ${r.error ?? 'unknown error'}`,
            timestamp: ts(),
          })
        }
      } catch (e: any) {
        results.push({
          channel: 'email',
          status: 'fail',
          detail: `Exception: ${e?.message ?? e}`,
          timestamp: ts(),
        })
      }
    }
  }

  /* ----- WhatsApp test ----- */
  if (waProvider as any !== false) {
    const userId = (await db.user.findUnique({ where: { email: 'antonio.can2022@hotmail.com' } }))?.id
    const pc = userId ? await db.phoneConfig.findFirst({ where: { userId } }) : null
    const targetPhone = phone ?? pc?.whatsappNumber ?? pc?.callmebotNumber ?? '15145496297'
    const testMsg = `Agent007 test message at ${new Date().toISOString()}`

    // Always test wa_link (always works)
    const waLink = generateWaLink(targetPhone, testMsg)
    results.push({
      channel: 'whatsapp:wa_link',
      status: 'pass',
      detail: `wa.me link generated for ${targetPhone}: ${waLink.slice(0, 80)}...`,
      timestamp: ts(),
    })

    // Test CallMeBot if API key is set OR explicit provider requested
    if (process.env.CALLMEBOT_API_KEY || pc?.callmebotApiKey || waProvider === 'callmebot') {
      const apiKey = process.env.CALLMEBOT_API_KEY ?? pc?.callmebotApiKey
      if (apiKey) {
        try {
          const r = await sendViaCallmebot({ phone: targetPhone, apiKey, message: testMsg })
          results.push({
            channel: 'whatsapp:callmebot',
            status: r.ok ? 'pass' : 'fail',
            detail: r.message ?? 'Sent',
            timestamp: ts(),
          })
        } catch (e: any) {
          results.push({
            channel: 'whatsapp:callmebot',
            status: 'fail',
            detail: `Exception: ${e?.message ?? e}`,
            timestamp: ts(),
          })
        }
      } else {
        results.push({
          channel: 'whatsapp:callmebot',
          status: 'warn',
          detail: 'No CallMeBot API key. Get one at https://www.callmebot.com/blog/free-api-whatsapp-messages/',
          timestamp: ts(),
        })
      }
    }

    // Test Baileys if userId has a linked session
    if (waProvider === 'baileys' && userId) {
      try {
        const r = await sendWhatsApp({ userId, to: targetPhone, message: testMsg })
        results.push({
          channel: 'whatsapp:baileys',
          status: r.ok ? 'pass' : 'fail',
          detail: r.message ?? 'Sent',
          timestamp: ts(),
        })
      } catch (e: any) {
        results.push({
          channel: 'whatsapp:baileys',
          status: 'fail',
          detail: `Exception: ${e?.message ?? e}`,
          timestamp: ts(),
        })
      }
    }
  }

  /* ----- SMS test ----- */
  if (testSms === true) {
    results.push({
      channel: 'sms',
      status: 'warn',
      detail: 'SMS provider not configured. Set up Twilio (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER) to enable SMS.',
      timestamp: ts(),
    })
  }

  /* ----- Inbound command polling test ----- */
  try {
    const inboundRes = await db.incomingCommand.count().catch(() => 0)
    results.push({
      channel: 'inbound_commands',
      status: 'pass',
      detail: `${inboundRes} command(s) in queue`,
      timestamp: ts(),
    })
  } catch {
    results.push({
      channel: 'inbound_commands',
      status: 'warn',
      detail: 'Could not query command queue',
      timestamp: ts(),
    })
  }

  /* ----- Overall ----- */
  const hasFail = results.some((r) => r.status === 'fail')
  const hasWarn = results.some((r) => r.status === 'warn')
  const overall = hasFail ? 'fail' : hasWarn ? 'warn' : 'pass'

  return NextResponse.json({
    ok: overall !== 'fail',
    overall,
    results,
    timestamp: new Date().toISOString(),
  })
}
