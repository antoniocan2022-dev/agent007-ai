/**
 * /api/system/morning-brief — UPGRADE #209
 *
 * On-demand trigger for the Morning Executive Brief.
 * Also triggered daily by Vercel Cron at /api/schedules/morning-brief (0 9 * * *)
 *
 * GET /api/system/morning-brief → runs the brief, returns it as JSON
 */
import { NextResponse } from 'next/server'
import { runMorningBrief } from '@/lib/autonomous-strategic-planner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET() {
  const result = await runMorningBrief()
  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}
