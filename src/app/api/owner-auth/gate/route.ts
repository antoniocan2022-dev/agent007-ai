import { NextRequest, NextResponse } from 'next/server'
import { ensureDbReady } from '@/lib/db'
import { requestOwnerAuthorization, verifyOwnerAuthorization, requiresOwnerAuth } from '@/lib/owner-auth'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/owner-auth/gate
 * 
 * Universal authorization gate for ALL reset/delete operations.
 * 
 * Body: { action: 'request', operation: 'delete_subagent' }
 *   → Sends 6-digit code to OWNER_PHONE via WhatsApp
 *   → Returns: { ok, authId, message, code? (fallback) }
 * 
 * Body: { action: 'verify', authId: '...', code: '123456' }
 *   → Verifies the code
 *   → Returns: { ok: true/false, message }
 */
export async function POST(req: NextRequest) {
  await ensureDbReady().catch(() => {})
  try {
    const body = await req.json()
    const action = (body.action || '').toString()

    if (action === 'request') {
      const operation = (body.operation || '').toString()
      if (!operation) return NextResponse.json({ error: 'operation required' }, { status: 400 })
      
      // Check if this operation needs authorization
      if (!requiresOwnerAuth(operation)) {
        return NextResponse.json({ ok: true, message: 'Operation does not require authorization', authorized: true })
      }

      const result = await requestOwnerAuthorization(operation)
      return NextResponse.json(result)
    }

    if (action === 'verify') {
      const { authId, code } = body
      if (!authId || !code) return NextResponse.json({ error: 'authId and code required' }, { status: 400 })
      const result = verifyOwnerAuthorization(authId.toString(), code.toString())
      return NextResponse.json(result)
    }

    return NextResponse.json({ error: 'Invalid action. Use request or verify.' }, { status: 400 })
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }) }
}
