import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sendWhatsApp, generateWaLink, normalizePhone, getBaileysStatus } from '@/lib/whatsapp-bridge'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const user = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 500 })
    const pc = await db.phoneConfig.findFirst({ where: { userId: user.id } })
    let baileysStatus: any = { status: 'disconnected', linkedNumber: null, qrCode: null, lastError: null }
    if (pc?.whatsappProvider === 'baileys') { try { baileysStatus = getBaileysStatus(user.id) } catch {} }
    return NextResponse.json({
      provider: pc?.whatsappProvider ?? 'none',
      whatsappEnabled: pc?.whatsappEnabled ?? false,
      whatsappNumber: pc?.whatsappNumber ?? null,
      callmebot: { apiKey: pc?.callmebotApiKey ? '••••' + pc.callmebotApiKey.slice(-4) : null, number: pc?.callmebotNumber ?? null },
      baileys: { status: baileysStatus.status, linkedNumber: baileysStatus.linkedNumber ?? pc?.baileysLinkedNumber ?? null, hasQrCode: !!baileysStatus.qrCode, lastError: baileysStatus.lastError ?? null },
    })
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }) }
}

export async function POST(req: NextRequest) {
  try {
    const user = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 500 })
    const body = await req.json()
    const action = (body.action ?? '').toString()
    let pc = await db.phoneConfig.findFirst({ where: { userId: user.id } })
    if (!pc) pc = await db.phoneConfig.create({ data: { userId: user.id } })

    if (action === 'set_provider') {
      const provider = (body.provider ?? 'none').toString()
      if (!['none', 'callmebot', 'baileys', 'wa_link'].includes(provider)) return NextResponse.json({ error: 'Invalid provider' }, { status: 400 })
      await db.phoneConfig.update({ where: { id: pc.id }, data: { whatsappProvider: provider, whatsappEnabled: provider !== 'none' } })
      return NextResponse.json({ ok: true, message: `Provider set to "${provider}".` })
    }
    if (action === 'set_callmebot') {
      const apiKey = (body.apiKey ?? '').toString().trim()
      const number = normalizePhone((body.number ?? '').toString())
      if (!apiKey || !number) return NextResponse.json({ error: 'apiKey and number required' }, { status: 400 })
      await db.phoneConfig.update({ where: { id: pc.id }, data: { whatsappProvider: 'callmebot', whatsappEnabled: true, callmebotApiKey: apiKey, callmebotNumber: number, whatsappNumber: number } })
      return NextResponse.json({ ok: true, message: `CallMeBot configured for ${number}.` })
    }
    if (action === 'start_baileys') {
      const { startBaileysSession } = await import('@/lib/whatsapp-bridge')
      const forceFresh = body.forceFresh === true
      const result = await startBaileysSession({ userId: user.id, forceFresh })
      return NextResponse.json({ ok: result.ok, message: result.message, qrCode: result.qrCode ?? null })
    }
    if (action === 'send_test') {
      const to = (body.to ?? '').toString() || undefined
      const message = (body.message ?? '🤖 Test from Agent007: WhatsApp is working!').toString()
      const result = await sendWhatsApp({ userId: user.id, to, message })
      return NextResponse.json(result)
    }
    if (action === 'generate_wa_link') {
      const to = (body.to ?? pc.whatsappNumber ?? '').toString()
      const message = (body.message ?? 'Hello from Agent007!').toString()
      return NextResponse.json({ ok: true, link: generateWaLink(to, message), message: 'Click link to open WhatsApp.' })
    }
    return NextResponse.json({ error: `Unknown action "${action}"` }, { status: 400 })
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }) }
}
