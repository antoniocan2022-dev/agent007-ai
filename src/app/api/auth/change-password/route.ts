import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions, hashPassword, verifyPassword } from '@/lib/auth'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const currentPassword = (body?.currentPassword ?? '').toString()
  const newPassword = (body?.newPassword ?? '').toString()

  if (!currentPassword || !newPassword) {
    return NextResponse.json(
      { ok: false, error: 'Both currentPassword and newPassword are required.' },
      { status: 400 }
    )
  }
  if (newPassword.length < 8) {
    return NextResponse.json(
      { ok: false, error: 'New password must be at least 8 characters.' },
      { status: 400 }
    )
  }
  if (newPassword.length > 200) {
    return NextResponse.json(
      { ok: false, error: 'New password is too long.' },
      { status: 400 }
    )
  }

  const user = await db.user.findUnique({ where: { email: session.user.email } })
  if (!user) {
    return NextResponse.json({ ok: false, error: 'User not found.' }, { status: 404 })
  }

  const valid = await verifyPassword(currentPassword, user.passwordHash)
  if (!valid) {
    return NextResponse.json(
      { ok: false, error: 'Current password is incorrect.' },
      { status: 400 }
    )
  }

  const passwordHash = await hashPassword(newPassword)
  await db.user.update({ where: { id: user.id }, data: { passwordHash } })

  return NextResponse.json({ ok: true, message: 'Password updated.' })
}
