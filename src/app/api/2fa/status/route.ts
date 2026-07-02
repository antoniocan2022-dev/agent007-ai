import { NextResponse } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'
import { SEED_EMAIL } from '@/lib/auth'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  await ensureDbReady()
  try {
    const user = await db.user.findUnique({ where: { email: SEED_EMAIL } })
    if (!user) return NextResponse.json({ configs: [], has2FA: false })
    const configs = await db.twoFactorSecret.findMany({ where: { userId: user.id }, select: { id: true, method: true, enabled: true, phoneNumber: true, email: true, verifiedAt: true } })
    return NextResponse.json({ configs, has2FA: configs.some(c => c.enabled), email: user.email })
  } catch (e: any) { return NextResponse.json({ configs: [], has2FA: false, error: e?.message }) }
}
