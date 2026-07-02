import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions, hashPassword, verifyPassword, SEED_EMAIL } from '@/lib/auth'
import { db, ensureDbReady } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  await ensureDbReady().catch(() => {})

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 }) }

  const currentPassword = (body?.currentPassword ?? '').toString()
  const newPassword = (body?.newPassword ?? '').toString()
  const email = (body?.email ?? SEED_EMAIL).toString().trim().toLowerCase()

  if (!currentPassword || !newPassword) {
    return NextResponse.json({ ok: false, error: 'Both currentPassword and newPassword are required.' }, { status: 400 })
  }
  if (newPassword.length < 8) {
    return NextResponse.json({ ok: false, error: 'New password must be at least 8 characters.' }, { status: 400 })
  }

  try {
    // Try session first, fall back to email from body
    let userEmail: string | undefined = undefined
    try {
      const session = await getServerSession(authOptions)
      if (session?.user?.email) userEmail = session.user.email
    } catch {}
    if (!userEmail) userEmail = email

    const user = await db.user.findUnique({ where: { email: userEmail } })
    if (!user) return NextResponse.json({ ok: false, error: 'User not found.' }, { status: 404 })

    const valid = await verifyPassword(currentPassword, user.passwordHash)
    if (!valid) return NextResponse.json({ ok: false, error: 'Current password is incorrect.' }, { status: 400 })

    const passwordHash = await hashPassword(newPassword)
    await db.user.update({ where: { id: user.id }, data: { passwordHash } })
    return NextResponse.json({ ok: true, message: 'Password changed successfully.' })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'Failed' }, { status: 500 })
  }
}
