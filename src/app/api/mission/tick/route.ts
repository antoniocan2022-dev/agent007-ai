/**
 * /api/mission/tick — UPGRADE #88
 * Daily mission tick endpoint — can be called by Vercel Cron or manually.
 * Runs the autonomous mission cycle: scout → aurora → pulse → echo.
 */
import { NextRequest, NextResponse } from 'next/server'
import { toolMissionMode } from '@/lib/max-autonomy-engine'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const action = url.searchParams.get('action') ?? 'tick'

  // Allow tick + status without auth (cron-callable)
  // report + reset require the owner token
  if (action === 'reset') {
    const token = url.searchParams.get('token')
    if (token !== 'agent007-owner-backup-2024-antonio-can-2022') {
      return NextResponse.json({ ok: false, error: 'Forbidden: reset requires owner token' }, { status: 403 })
    }
  }

  const result = await toolMissionMode({ action })
  return NextResponse.json({
    ok: result.ok,
    action,
    timestamp: new Date().toISOString(),
    preview: result.preview,
    result: result.result,
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const action = body.action ?? 'tick'
  const result = await toolMissionMode({ action, ...body })
  return NextResponse.json({
    ok: result.ok,
    action,
    timestamp: new Date().toISOString(),
    preview: result.preview,
    result: result.result,
  })
}
