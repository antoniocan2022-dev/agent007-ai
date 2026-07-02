import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { userId, code } = body
    if (!userId || !code) return NextResponse.json({ error: 'userId and code required' }, { status: 400 })
    const _g: any = globalThis as any
    const challenges = _g.__2faChallenges
    if (!challenges || !challenges.has(userId)) return NextResponse.json({ error: 'No challenge found. Request a new code.' }, { status: 400 })
    const challenge = challenges.get(userId)
    if (Date.now() > challenge.expiresAt) { challenges.delete(userId); return NextResponse.json({ error: 'Code expired' }, { status: 400 }) }
    if (code !== challenge.code) return NextResponse.json({ error: 'Invalid code' }, { status: 400 })
    challenges.delete(userId)
    try { await db.auditLog.create({ data: { userId, action: '2fa_verified', entity: 'auth', description: '2FA challenge verified' } }) } catch {}
    return NextResponse.json({ ok: true, message: '2FA verified' })
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }) }
}
