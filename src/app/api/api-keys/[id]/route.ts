import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUserId } from '@/lib/session-user'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * DELETE /api/api-keys/[id]
 *
 * Deletes an API key by id.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getSessionUserId()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    await db.apiKey.deleteMany({ where: { id, userId } })
    return NextResponse.json({ ok: true, message: 'API key deleted.' })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'unknown' }, { status: 500 })
  }
}

/**
 * GET /api/api-keys/[id]?reveal=true
 *
 * Returns the FULL (deobfuscated) API key value. Use with caution.
 * Without ?reveal=true, returns only the masked version.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getSessionUserId()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const reveal = new URL(req.url).searchParams.get('reveal') === 'true'

    const row = await db.apiKey.findFirst({ where: { id, userId } })
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // UPGRADE #173 fix #1 (revised): The original code did
    // `await import('../route').deobf` to "deobfuscate" the key, but:
    //   1. The parent route (api-keys/route.ts) doesn't export `deobf` —
    //      it's actually in payment-accounts/route.ts. So the import
    //      would throw `TypeError: deobf is not a function`.
    //   2. More fundamentally, api-keys/route.ts:175 stores keys as
    //      PLAINTEXT (`key: keyStr` — no obf() call). The deobf was
    //      never needed for apiKeys, only for payment-accounts which
    //      uses obf() in its create handler.
    // AFTER — return the plaintext key directly. No deobfuscation
    // needed for apiKeys.
    const fullKey = row.key || ''
    const masked = fullKey ? '••••••••' + fullKey.slice(-4) : ''

    return NextResponse.json({
      id: row.id,
      name: row.name,
      service: row.service,
      key: reveal ? fullKey : masked,
      keyMasked: masked,
      baseUrl: row.baseUrl,
      revealed: reveal,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'unknown' }, { status: 500 })
  }
}
