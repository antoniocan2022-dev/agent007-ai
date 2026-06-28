import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const conv = await db.conversation.findUnique({
    where: { id },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  })
  if (!conv) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ conversation: conv })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  await db.conversation.delete({ where: { id } }).catch(() => null)
  return NextResponse.json({ ok: true })
}
