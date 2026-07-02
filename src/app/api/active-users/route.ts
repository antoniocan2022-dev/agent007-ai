import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const count = await db.conversation.count({ where: { updatedAt: { gte: new Date(Date.now() - 5 * 60 * 1000) } } })
    return NextResponse.json({ count, windowMs: 300000 })
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }) }
}
