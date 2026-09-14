import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isOwnerEmail } from '@/lib/owner-config'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Deep-audit fix: this used to accept ANY authenticated session (`session?.user`), letting any
 * approved non-owner account enumerate every other user's email/name via this endpoint. This app
 * supports multi-user registration, so "any session" was never equivalent to "the owner" -- same
 * class of bug fixed in owner-request-auth.ts. Owner-only now.
 *
 * Also now surfaces `approved` per user so the owner can actually see who is pending -- this is
 * the real "see pending users" half of the Dashboard capability user-approval.ts documents;
 * see /api/users/:id PATCH for the matching approve/reject action.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!isOwnerEmail(session?.user?.email)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const users = await db.user.findMany({ select: { id: true, email: true, name: true, createdAt: true } })
    const approvedRows = await db.userSetting.findMany({ where: { key: 'approved', userId: { in: users.map(u => u.id) } } })
    const approvedIds = new Set(approvedRows.map(r => r.userId))
    return NextResponse.json({
      users: users.map(u => ({ ...u, approved: isOwnerEmail(u.email) || approvedIds.has(u.id) })),
    })
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }) }
}
