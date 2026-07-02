import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUserId } from '@/lib/session-user'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const userId = await getSessionUserId()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const url = new URL(req.url)
    const status = url.searchParams.get('status') ?? 'pending'
    const limit = Math.min(50, parseInt(url.searchParams.get('limit') ?? '20'))
    const where: any = { userId }
    if (status !== 'all') where.status = status
    const commands = await db.incomingCommand.findMany({ where, orderBy: { receivedAt: 'desc' }, take: limit })
    return NextResponse.json({ commands, count: commands.length })
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }) }
}
