import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { disconnectBaileys } from '@/lib/whatsapp-bridge'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    const user = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 500 })
    const result = await disconnectBaileys(user.id)
    try { const pc = await db.phoneConfig.findFirst({ where: { userId: user.id } }); if (pc) await db.phoneConfig.update({ where: { id: pc.id }, data: { baileysSessionStatus: 'disconnected', baileysLinkedNumber: null, baileysLinkedAt: null, whatsappEnabled: false } }) } catch {}
    return NextResponse.json(result)
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }) }
}
