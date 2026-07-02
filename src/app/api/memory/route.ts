import { NextRequest, NextResponse } from 'next/server'
import { requestOwnerAuthorization, verifyOwnerAuthorization } from '@/lib/owner-auth'
import { db, ensureDbReady } from '@/lib/db'
import { listMemories, upsertMemory } from '@/lib/memory'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const category = req.nextUrl.searchParams.get('category') ?? undefined
  const memories = await listMemories(category ?? undefined)
  return NextResponse.json({ memories })
}

export async function POST(req: NextRequest) {
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
  const rec = await upsertMemory(key, value, category ?? 'general')
  // Touch updatedAt on conversation list ordering later if needed
  return NextResponse.json({ memory: rec })
}

// Owner authorization required for delete operations
async function checkOwnerAuth(operation: string, req: any): Promise<{ ok: boolean; error?: string }> {
  try {
    const authHeader = req.headers.get('x-owner-auth')
    if (authHeader) {
      const { authId, code } = JSON.parse(authHeader)
      const result = verifyOwnerAuthorization(authId, code)
      if (!result.ok) return { ok: false, error: result.message }
      return { ok: true }
    }
  } catch {}
  // No auth provided — request it
  const authResult = await requestOwnerAuthorization(operation)
  return { ok: false, error: 'OWNER_AUTH_REQUIRED:' + JSON.stringify(authResult) }
}

export async function DELETE(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key')
  if (!key) return NextResponse.json({ error: 'Missing ?key=' }, { status: 400 })
  await db.memory.deleteMany({ where: { key } })
  return NextResponse.json({ ok: true })
}
