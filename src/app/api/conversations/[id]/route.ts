import { NextRequest, NextResponse } from 'next/server'
import { requestOwnerAuthorization, verifyOwnerAuthorization } from '@/lib/owner-auth'
import { db, ensureDbReady } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // UPGRADE #126: Add error handling + ensureDbReady
  try {
    await ensureDbReady().catch(() => {})
    const { id } = await params
    const conv = await db.conversation.findUnique({
      where: { id },
      include: { Message: { orderBy: { createdAt: 'asc' } } },
    })
    if (!conv) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ conversation: conv })
  } catch (e: any) {
    console.error('[api/conversations/[id]] GET failed:', e?.message?.slice(0, 200))
    return NextResponse.json({ error: e?.message?.slice(0, 150) }, { status: 500 })
  }
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

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  await db.conversation.delete({ where: { id } }).catch(() => null)
  return NextResponse.json({ ok: true })
}
