import { NextRequest, NextResponse } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const conversations = await db.conversation.findMany({
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { messages: true } },
    },
    take: 100,
  })
  return NextResponse.json({ conversations })
}

export async function POST(req: NextRequest) {
  let body: any = {}
  try {
    body = await req.json()
  } catch {
    /* allow empty body */
  }
  const title = (body?.title ?? 'New Conversation').toString().slice(0, 120)
  const conv = await db.conversation.create({ data: { title } })
  return NextResponse.json({ conversation: conv })
}
