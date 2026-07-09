import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/phone-config
 * Returns the owner's phone/WhatsApp/email command configuration.
 *
 * POST /api/phone-config
 * Creates or updates the phone/WhatsApp/email config.
 * Body: { phoneNumber?, whatsappNumber?, email?, smsEnabled?, whatsappEnabled?, emailEnabled?, twilio*?, whatsapp*?, emailImap*? }
 */
export async function GET() {
  // Direct DB lookup — works without auth for the settings panel
  const seedUser = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!seedUser) return NextResponse.json({ config: null })

  let config = await db.phoneConfig.findFirst({ where: { userId: seedUser.id } })
  if (!config) {
    config = await db.phoneConfig.create({ data: { userId: seedUser.id } })
  }
  return NextResponse.json({ config })
}

export async function POST(req: NextRequest) {
  // Direct DB lookup — works without auth
  const seedUser = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!seedUser) return NextResponse.json({ error: 'No user found' }, { status: 500 })
  const userId = seedUser.id

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const data: any = {}
  const fields = [
    'phoneNumber', 'whatsappNumber', 'email',
    'smsEnabled', 'whatsappEnabled', 'emailEnabled',
    'twilioAccountSid', 'twilioAuthToken', 'twilioPhoneNumber',
    'whatsappApiToken', 'whatsappPhoneId',
    'emailImapHost', 'emailImapPort', 'emailImapUser', 'emailImapPassword',
  ]
  for (const f of fields) {
    if (body[f] !== undefined) data[f] = body[f]
  }

  let config = await db.phoneConfig.findFirst({ where: { userId } })
  if (config) {
    config = await db.phoneConfig.update({ where: { id: config.id }, data })
  } else {
    config = await db.phoneConfig.create({ data: { userId, ...data } })
  }
  return NextResponse.json({ config, ok: true })
}
