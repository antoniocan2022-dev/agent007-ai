import { NextRequest, NextResponse } from 'next/server'
import { sendEmail } from '@/lib/email'
import { getOperatorUserId } from '@/lib/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST /api/notifications/send — send (or log) an email. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const { to, subject, body: emailBody, type } = body as {
      to?: string
      subject?: string
      body?: string
      type?: string
    }
    if (!to || !subject || !emailBody) {
      return NextResponse.json({ error: 'Missing to/subject/body' }, { status: 400 })
    }
    const userId = await getOperatorUserId()
    const result = await sendEmail({
      to,
      subject,
      body: emailBody,
      userId: userId ?? undefined,
      type: type ?? 'mission_complete',
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (e: any) {
    console.error('[notifications/send]', e)
    return NextResponse.json({ error: e?.message ?? 'Failed to send' }, { status: 500 })
  }
}
