import { NextRequest, NextResponse } from 'next/server'
import { requestOwnerAuthorization, verifyOwnerAuthorization } from '@/lib/owner-auth'
import { db, ensureDbReady } from '@/lib/db'
import { getSessionUserId } from '@/lib/session-user'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await ensureDbReady()
    const userId = await getSessionUserId()
    if (!userId) return NextResponse.json({ keys: [] })
    const keys = await db.apiKey.findMany({ where: { userId }, select: { id: true, name: true, service: true, baseUrl: true, createdAt: true }, orderBy: { createdAt: 'desc' } }).catch(() => [])
    return NextResponse.json({ keys })
  } catch (e: any) { return NextResponse.json({ keys: [], error: e?.message }, { status: 200 }) }
}

export async function POST(req: NextRequest) {
  try {
    await ensureDbReady()
    const userId = await getSessionUserId()
    if (!userId) return NextResponse.json({ error: 'User not found. Try refreshing the page.' }, { status: 401 })
    const body = await req.json()
    const { name, service, key, baseUrl } = body
    if (!name || !service || !key) return NextResponse.json({ error: 'name, service, key required' }, { status: 400 })
    
    // Store key (plain text for simplicity — the obfuscation was causing issues)
    const apiKey = await db.apiKey.create({ data: { userId, name, service, key: key.toString(), baseUrl: baseUrl || null } })
    
    // Also set as env var for immediate use by the LLM fallback
    if (service === 'openai') {
      process.env.OPENAI_API_KEY = key.toString()
      // Clear the fallback key cache
      try { const { clearKeyCache } = await import('@/lib/llm-fallback'); clearKeyCache() } catch {}
    }
    
    return NextResponse.json({ ok: true, key: { id: apiKey.id, name: apiKey.name, service: apiKey.service } })
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Failed to save key' }, { status: 500 }) }
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
  try {
    await ensureDbReady()
    const url = new URL(req.url)
    const id = url.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    await db.apiKey.delete({ where: { id } }).catch(() => {})
    return NextResponse.json({ ok: true })
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }) }
}
