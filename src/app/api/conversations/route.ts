import { NextRequest, NextResponse } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  // UPGRADE #126: Add error handling + ensureDbReady
  // Previously: if DB query failed, the route threw an unhandled error → 500
  // → client got HTML error page → safeJson returned {error: text} →
  // data.conversations was undefined → conversations list stayed empty
  try {
    await ensureDbReady().catch(() => {})
    const conversations = await db.conversation.findMany({
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
    // Return empty array instead of crashing — lets the UI render
    return NextResponse.json({ conversations: [], error: e?.message?.slice(0, 150) }, { status: 200 })
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureDbReady().catch(() => {})
    let body: any = {}
    try {
      body = await req.json()
    } catch {
      /* allow empty body */
    }
    const title = (body?.title ?? 'New Conversation').toString().slice(0, 120)
    const conv = await db.conversation.create({ data: { title } })
    return NextResponse.json({ conversation: conv })
  } catch (e: any) {
    console.error('[api/conversations] POST failed:', e?.message?.slice(0, 200))
    return NextResponse.json({ error: e?.message?.slice(0, 150) }, { status: 500 })
  }
}
