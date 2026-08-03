/**
 * /api/system/goals — UPGRADE #230
 *
 * The 6 Organizational Goals endpoint.
 *
 * GET /api/system/goals → all goals with current progress
 * GET /api/system/goals?summary=true → compact summary
 */
import { NextRequest, NextResponse } from 'next/server'
import { getOrganizationalGoals, getGoalsSummary } from '@/lib/organizational-goals'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const summaryOnly = url.searchParams.get('summary') === 'true'

  if (summaryOnly) {
    const summary = await getGoalsSummary()
    return NextResponse.json({ ok: true, ...summary })
  }

  const goals = await getOrganizationalGoals()
  return NextResponse.json({ ok: true, count: goals.length, goals })
}
