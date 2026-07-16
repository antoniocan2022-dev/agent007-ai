/**
 * /api/decisions — UPGRADE #88
 * Auto-decision engine endpoint.
 * View decision log, approve/reject pending decisions, evaluate new decisions.
 */
import { NextRequest, NextResponse } from 'next/server'
import { toolAutoDecisionEngine } from '@/lib/max-autonomy-engine'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const action = url.searchParams.get('action') ?? 'log'
  const result = await toolAutoDecisionEngine({ action })
  return NextResponse.json({
    ok: result.ok,
    preview: result.preview,
    result: result.result,
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const action = body.action ?? 'evaluate'
  const result = await toolAutoDecisionEngine({ action, ...body })
  return NextResponse.json({
    ok: result.ok,
    preview: result.preview,
    result: result.result,
  })
}
