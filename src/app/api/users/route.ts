import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const users = await db.user.findMany({ select: { id: true, email: true, name: true, createdAt: true } })
    return NextResponse.json({ users })
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }) }
}
