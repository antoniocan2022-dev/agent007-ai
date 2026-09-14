import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions, hashPassword } from '@/lib/auth'
import { db } from '@/lib/db'
import { isOwnerEmail } from '@/lib/owner-config'
import { approveUserById, rejectUserById } from '@/lib/user-approval'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Deep-audit fix: DELETE and PATCH below used to accept ANY authenticated session
 * (`session?.user`), not just the owner's. Since this app supports multi-user registration, that
 * meant any approved non-owner account could delete any other user, or PATCH another user's
 * email/password -- a full account-takeover IDOR. Both handlers are owner-only now, matching the
 * fix already applied to GET /api/users and owner-request-auth.ts's guard.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions)
    if (!isOwnerEmail(session?.user?.email)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    const user = await db.user.findUnique({ where: { id } })
    if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (isOwnerEmail(user.email)) return NextResponse.json({ error: 'Cannot delete primary operator' }, { status: 403 })
    // UPGRADE #173 fix #7: BEFORE used `conversation` (lowercase — invalid
    // field; Prisma expects the relation name `Conversation` capitalized).
    // AFTER — use the proper relation name with a valid where clause on
    // the related Conversation model.
    await db.message.deleteMany({ where: { Conversation: { userId: id } } }).catch(() => {})
    await db.conversation.deleteMany({ where: { userId: id } }).catch(() => {})
    await db.schedule.deleteMany({ where: { userId: id } }).catch(() => {})
    // Note: Memory table has no userId column (it's global key-value); skip.
    // To wipe operator's memories, use the dedicated /api/memory DELETE endpoint.
    await db.customSubagent.deleteMany({ where: { userId: id } }).catch(() => {})
    await db.incomeEntry.deleteMany({}).catch(() => {})
    await db.platformConnection.deleteMany({ where: { userId: id } }).catch(() => {})
    await db.twoFactorSecret.deleteMany({ where: { userId: id } }).catch(() => {})
    await db.auditLog.deleteMany({ where: { userId: id } }).catch(() => {})
    await db.user.delete({ where: { id } })
    return NextResponse.json({ ok: true, message: `User "${user.email}" deleted.` })
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }) }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions)
    if (!isOwnerEmail(session?.user?.email)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    const body = await req.json()

    if (body.action === 'approve' || body.action === 'reject') {
      const user = await db.user.findUnique({ where: { id } })
      if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      if (body.action === 'approve') {
        await approveUserById(id)
        return NextResponse.json({ ok: true, message: `User "${user.email}" approved.` })
      }
      await rejectUserById(id)
      return NextResponse.json({ ok: true, message: `User "${user.email}" rejected and deleted.` })
    }

    const update: any = {}
    if (body.email) update.email = body.email.toString().trim().toLowerCase()
    if (body.name !== undefined) update.name = body.name.toString().trim()
    if (body.password) { if (body.password.length < 6) return NextResponse.json({ error: 'Password 6+ chars' }, { status: 400 }); update.passwordHash = await hashPassword(body.password) }
    if (Object.keys(update).length === 0) return NextResponse.json({ error: 'No fields' }, { status: 400 })
    const user = await db.user.update({ where: { id }, data: update })
    return NextResponse.json({ ok: true, user: { id: user.id, email: user.email, name: user.name } })
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }) }
}
