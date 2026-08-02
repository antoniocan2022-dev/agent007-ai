/**
 * /api/system/mission — UPGRADE #209
 *
 * Mission OS Pipeline endpoint.
 * Runs a request through the full 8-stage mission lifecycle:
 * UNDERSTAND → PLAN → CONTEXT → DISPATCH → EXECUTE → VERIFY → DECIDE → LEARN
 *
 * POST /api/system/mission
 * Body: { "request": "Analyze Tesla stock and recommend whether to invest" }
 */
import { NextRequest, NextResponse } from 'next/server'
import { runMissionPipeline } from '@/lib/mission-os'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 180

export async function POST(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const userRequest = body?.request
  if (!userRequest || typeof userRequest !== 'string') {
    return NextResponse.json({ ok: false, error: 'Missing "request" field' }, { status: 400 })
  }

  const result = await runMissionPipeline(userRequest)
  return NextResponse.json({ ok: true, ...result })
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const userRequest = url.searchParams.get('request')
  if (!userRequest) {
    return NextResponse.json({
      ok: false,
      error: 'Missing "request" query parameter',
      usage: 'GET /api/system/mission?request=Analyze+Tesla+stock',
    }, { status: 400 })
  }

  const result = await runMissionPipeline(userRequest)
  return NextResponse.json({ ok: true, ...result })
}
