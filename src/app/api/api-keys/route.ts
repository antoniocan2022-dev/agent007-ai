import { NextRequest, NextResponse } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'
import { getSessionUserId } from '@/lib/session-user'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await ensureDbReady().catch(() => {})
    const userId = await getSessionUserId()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const keys = await db.apiKey.findMany({ where: { userId }, select: { id: true, name: true, service: true, baseUrl: true, createdAt: true, updatedAt: true }, orderBy: { createdAt: 'desc' } })
    return NextResponse.json({ keys })
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }) }
}

export async function POST(req: NextRequest) {
  try {
    await ensureDbReady().catch(() => {})
    const userId = await getSessionUserId()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body = await req.json()
    const { name, service, key, baseUrl } = body
    if (!name || !service || !key) return NextResponse.json({ error: 'name, service, key required' }, { status: 400 })
    const OBF_SALT = 'agent007-obf-salt-2024'
    const obfKey = Buffer.from(key + OBF_SALT).toString('base64')
    const apiKey = await db.apiKey.create({ data: { userId, name, service, key: obfKey, baseUrl: baseUrl || null } })
    return NextResponse.json({ ok: true, key: { id: apiKey.id, name: apiKey.name, service: apiKey.service } })
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }) }
}
