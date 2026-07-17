/**
 * /api/reality-check — UPGRADE #89
 * Returns the truth about Agent007's real capabilities vs virtual.
 * Inspired by external analysis (July 15 audit) that correctly identified
 * that 588 tools claim is misleading — only ~60 are real executable.
 */
import { NextRequest, NextResponse } from 'next/server'
import { toolToolsRealityCheck, toolIncomeRealityCheck, toolMissionActionTick, toolScheduleActionMode } from '@/lib/reality-action-mode'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const check = url.searchParams.get('check') ?? 'all'

  const results: any = {
    ok: true,
    timestamp: new Date().toISOString(),
    url: 'https://agent007-ai.vercel.app',
  }

  if (check === 'all' || check === 'tools') {
    const r = await toolToolsRealityCheck({ action: 'classify' })
    results.tools = {
      ok: r.ok,
      preview: r.preview,
      result: r.result,
    }
  }

  if (check === 'all' || check === 'income') {
    const r = await toolIncomeRealityCheck({ action: 'stats' })
    results.income = {
      ok: r.ok,
      preview: r.preview,
      result: r.result,
    }
  }

  if (check === 'all' || check === 'mission') {
    const r = await toolMissionActionTick({})
    results.mission = {
      ok: r.ok,
      preview: r.preview,
      result: r.result.slice(0, 2000), // truncate for API response
    }
  }

  if (check === 'all' || check === 'schedules') {
    const r = await toolScheduleActionMode({ action: 'view' })
    results.schedules = {
      ok: r.ok,
      preview: r.preview,
      result: r.result,
    }
  }

  return NextResponse.json(results)
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { tool, action, ...rest } = body

  let result
  if (tool === 'tools_reality_check') {
    result = await toolToolsRealityCheck({ action, ...rest })
  } else if (tool === 'income_reality_check') {
    result = await toolIncomeRealityCheck({ action, ...rest })
  } else if (tool === 'mission_action_tick') {
    result = await toolMissionActionTick({ action, ...rest })
  } else if (tool === 'schedule_action_mode') {
    result = await toolScheduleActionMode({ action, ...rest })
  } else {
    return NextResponse.json({ ok: false, error: `Unknown tool: ${tool}. Use: tools_reality_check | income_reality_check | mission_action_tick | schedule_action_mode` }, { status: 400 })
  }

  return NextResponse.json({
    ok: result.ok,
    preview: result.preview,
    result: result.result,
  })
}
