import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST /api/commands/receive — webhook for inbound commands from SMS/WhatsApp/Email */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { source, fromNumber, fromEmail, command } = body as { source?: string; fromNumber?: string; fromEmail?: string; command?: string }
    if (!source || !command) return NextResponse.json({ error: 'Missing source or command' }, { status: 400 })
    if (!['sms', 'whatsapp', 'email'].includes(source)) return NextResponse.json({ error: `Invalid source` }, { status: 400 })

    let userId: string | null = null
    if (source === 'whatsapp' && fromNumber) { const c = await db.phoneConfig.findFirst({ where: { whatsappEnabled: true, whatsappNumber: fromNumber } }); if (c) userId = c.userId }
    if (!userId) { const u = await db.user.findFirst({ orderBy: { createdAt: 'asc' } }); userId = u?.id ?? null }
    if (!userId) return NextResponse.json({ error: 'No matching user' }, { status: 403 })

    const cmd = await db.incomingCommand.create({ data: { userId, source, fromNumber: fromNumber || null, fromEmail: fromEmail || null, command: command.slice(0, 5000), status: 'pending' } })
    return NextResponse.json({ ok: true, commandId: cmd.id, message: `Command received from ${source}.` })
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }) }
}

/** GET /api/commands/receive — returns pending commands for the inbox */
export async function GET() {
  const user = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!user) return NextResponse.json({ commands: [] })
  const commands = await db.incomingCommand.findMany({ where: { userId: user.id }, orderBy: { receivedAt: 'desc' }, take: 50 })
  return NextResponse.json({ commands })
}
