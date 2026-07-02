import { NextResponse } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'
import { getBaileysQrCode, getBaileysStatus } from '@/lib/whatsapp-bridge'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await ensureDbReady().catch(() => {})
    const user = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 500 })
    const status = getBaileysStatus(user.id)
    return NextResponse.json({ qrCode: getBaileysQrCode(user.id), status: status.status, linkedNumber: status.linkedNumber, lastError: status.lastError ?? null })
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }) }
}
