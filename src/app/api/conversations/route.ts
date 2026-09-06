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

export async function GET() {
  try {
    const userId = sessionUserId(await getServerSession(authOptions))
    if (!userId) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 })
    await ensureDbReady().catch(() => {})
    const conversations = await db.conversation.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { Message: true } },
      },
      take: 100,
    })
    return NextResponse.json({ conversations })
  } catch (e: any) {
    console.error('[api/conversations] GET failed:', e?.message?.slice(0, 200))
    return NextResponse.json({ conversations: [], error: 'Unable to load conversations.' }, { status: 503 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = sessionUserId(await getServerSession(authOptions))
    if (!userId) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 })
    await ensureDbReady().catch(() => {})
    let body: any = {}
    try {
      body = await req.json()
    } catch {
      /* allow empty body */
    }
    const title = (body?.title ?? 'New Conversation').toString().slice(0, 120)
    const conv = await db.conversation.create({ data: { title, userId } })
    return NextResponse.json({ conversation: conv })
  } catch (e: any) {
    console.error('[api/conversations] POST failed:', e?.message?.slice(0, 200))
    return NextResponse.json({ error: 'Unable to create conversation.' }, { status: 503 })
  }
}