import { NextRequest, NextResponse } from 'next/server'
import { verifyOwnerAuthorization } from '@/lib/owner-auth'
import { getSessionUserId } from '@/lib/session-user'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST /api/owner-auth/verify — verify the owner's authorization code */
export async function POST(req: NextRequest) {
  try {
    const userId = await getSessionUserId()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body = await req.json()
    const { authId, code } = body
    if (!authId || !code) return NextResponse.json({ error: 'Missing authId or code' }, { status: 400 })
    const result = verifyOwnerAuthorization(authId, code.toString())
    return NextResponse.json(result)
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }) }
}
