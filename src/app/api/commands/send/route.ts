import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUserId } from '@/lib/session-user'
import { sendWhatsApp } from '@/lib/whatsapp-bridge'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const userId = await getSessionUserId()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body = await req.json()
    const { to, channel, message, subject } = body
    if (!message) return NextResponse.json({ error: 'Missing message' }, { status: 400 })
    if (channel === 'whatsapp') {
      const result = await sendWhatsApp({ userId, to, message })
      return NextResponse.json(result)
    }
    if (channel === 'email') {
      const { sendEmail } = await import('@/lib/email')
      try { await sendEmail({ to, subject: subject || 'Agent007 Notification', body: message, userId, type: 'notification' }); return NextResponse.json({ ok: true, message: '✅ Email sent' }) }
      catch (e: any) { return NextResponse.json({ ok: false, message: `Email failed: ${e?.message}` }) }
    }
    return NextResponse.json({ error: `Unknown channel: ${channel}` }, { status: 400 })
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }) }
}
