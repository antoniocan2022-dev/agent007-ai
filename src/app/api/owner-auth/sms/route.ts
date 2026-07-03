import { NextRequest, NextResponse } from 'next/server'
import { requestOwnerAuthorization } from '@/lib/owner-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/owner-auth/sms
 * Requests owner authorization via SMS (or wa.me fallback).
 *
 * Body: { operation: "delete_subagent" }
 *
 * Returns: { ok, authId, message, code?, waLink?, method }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const operation = (body.operation as string | undefined)?.toString().trim()
    if (!operation) {
      return NextResponse.json({ ok: false, error: 'operation required' }, { status: 400 })
    }

    const result = await requestOwnerAuthorization(operation, 'sms')
    return NextResponse.json(result, { status: result.ok ? 200 : 400 })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 })
  }
}
