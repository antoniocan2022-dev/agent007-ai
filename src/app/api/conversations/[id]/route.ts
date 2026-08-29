import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { db, ensureDbReady } from '@/lib/db'
import { authOptions } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type SessionLike = { user?: { id?: unknown } } | null
function sessionUserId(session: unknown): string {
  const user = (session as SessionLike)?.user
  return typeof user?.id === 'string' ? user.id : ''
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = sessionUserId(await getServerSession(authOptions))
    if (!userId) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 })
    await ensureDbReady().catch(() => {})
    const { id } = await params
    const conv = await db.conversation.findFirst({
      where: { id, userId },
      include: { Message: { orderBy: { createdAt: 'asc' } } },
    })
    if (!conv) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ conversation: conv })
  } catch (e: any) {
    console.error('[api/conversations/[id]] GET failed:', e?.message?.slice(0, 200))
    return NextResponse.json({ error: e?.message?.slice(0, 150) }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = sessionUserId(await getServerSession(authOptions))
    if (!userId) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 })
    const { id } = await params
    const conversation = await db.conversation.findFirst({ where: { id, userId }, select: { id: true } })
    if (!conversation) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await db.conversation.delete({ where: { id: conversation.id } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error('[api/conversations/[id]] DELETE failed:', e?.message?.slice(0, 200))
    return NextResponse.json({ error: e?.message?.slice(0, 150) }, { status: 500 })
  }
}