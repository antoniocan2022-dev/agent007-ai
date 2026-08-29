import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { db, ensureDbReady } from '@/lib/db'
import { authOptions } from '@/lib/auth'
import { listMemories, upsertMemory } from '@/lib/memory'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isAuthenticated(session: Awaited<ReturnType<typeof getServerSession>>): boolean {
  return typeof (session?.user as { id?: unknown } | undefined)?.id === 'string' && Boolean((session?.user as { id: string }).id)
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!isAuthenticated(session)) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 })
  await ensureDbReady().catch(() => {})
  const category = req.nextUrl.searchParams.get('category') ?? undefined
  try {
    const memories = await listMemories(category ?? undefined)
    return NextResponse.json({ memories })
  } catch (e: any) {
    console.error('[api/memory] GET failed:', e?.message?.slice(0, 200))
    return NextResponse.json({ error: 'Unable to load memories.' }, { status: 503 })
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!isAuthenticated(session)) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 })
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { key, value, category } = body as { key?: string; value?: string; category?: string }
  if (!key || !value) {
    return NextResponse.json({ error: 'Missing key or value' }, { status: 400 })
  }
  try {
    const rec = await upsertMemory(key, value, category ?? 'general')
    return NextResponse.json({ memory: rec })
  } catch (e: any) {
    console.error('[api/memory] POST failed:', e?.message?.slice(0, 200))
    return NextResponse.json({ error: 'Unable to save memory.' }, { status: 503 })
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!isAuthenticated(session)) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 })
  const key = req.nextUrl.searchParams.get('key')
  if (!key) return NextResponse.json({ error: 'Missing ?key=' }, { status: 400 })
  try {
    await db.memory.deleteMany({ where: { key } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error('[api/memory] DELETE failed:', e?.message?.slice(0, 200))
    return NextResponse.json({ error: 'Unable to delete memory.' }, { status: 503 })
  }
}