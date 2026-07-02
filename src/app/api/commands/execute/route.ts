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
    const { commandId, replyMessage, markCompleted } = body
    if (!commandId) return NextResponse.json({ error: 'Missing commandId' }, { status: 400 })
    const cmd = await db.incomingCommand.findFirst({ where: { id: commandId, userId } })
    if (!cmd) return NextResponse.json({ error: 'Command not found' }, { status: 404 })
    if (replyMessage) {
      const recipient = cmd.fromNumber || cmd.fromEmail
      if (recipient) {
        if (cmd.source === 'whatsapp') await sendWhatsApp({ userId, to: recipient, message: replyMessage }).catch(() => {})
        else if (cmd.source === 'email') { const { sendEmail } = await import('@/lib/email'); await sendEmail({ to: recipient, subject: 'Re: Your command', body: replyMessage, userId, type: 'reply' }).catch(() => {}) }
      }
    }
    if (markCompleted !== false) {
      await db.incomingCommand.update({ where: { id: commandId }, data: { status: 'completed', executedAt: new Date(), result: replyMessage || 'executed' } })
    }
    return NextResponse.json({ ok: true, command: cmd.command, source: cmd.source, fromNumber: cmd.fromNumber, fromEmail: cmd.fromEmail })
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }) }
}
