import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUserId } from '@/lib/session-user'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const userId = await getSessionUserId()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const accounts = await db.payPalAccount.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } })
    return NextResponse.json({ accounts })
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }) }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getSessionUserId()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body = await req.json()
    const { email, clientId, clientSecret } = body
    if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 })
    const OBF_SALT = 'agent007-obf-salt-2024'
    const account = await db.payPalAccount.create({ data: { userId, email, clientId: clientId ? Buffer.from(clientId + OBF_SALT).toString('base64') : null, clientSecret: clientSecret ? Buffer.from(clientSecret + OBF_SALT).toString('base64') : null } })
    return NextResponse.json({ ok: true, account: { id: account.id, email: account.email } })
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }) }
}
