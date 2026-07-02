import { NextRequest, NextResponse } from 'next/server'
import { requestOwnerAuthorization, requiresOwnerAuth } from '@/lib/owner-auth'
import { getSessionUserId } from '@/lib/session-user'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST /api/owner-auth/request — request authorization code for a protected operation */
export async function POST(req: NextRequest) {
  try {
    const userId = await getSessionUserId()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body = await req.json()
    const operation = (body.operation ?? '').toString()
    if (!operation) return NextResponse.json({ error: 'Missing operation' }, { status: 400 })
    if (!requiresOwnerAuth(operation)) return NextResponse.json({ ok: true, message: 'Operation does not require owner authorization', skipped: true })
    const result = await requestOwnerAuthorization(operation)
    return NextResponse.json(result)
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }) }
}
