/**
 * /api/schedules/morning-brief — UPGRADE #209
 *
 * Vercel Cron trigger for the Morning Executive Brief.
 * Schedule: 0 9 * * * (every day at 9AM UTC)
 *
 * ARCHITECTURE NOTE (UPGRADE #212):
 * There are TWO Morning Brief endpoints — this is BY DESIGN, not duplication:
 *
 * 1. /api/schedules/morning-brief (THIS FILE)
 *    - Triggered by: Vercel Cron (0 9 * * *)
 *    - Auth: NONE (Vercel Cron can't authenticate)
 *    - Purpose: Automated daily execution at 9AM UTC
 *    - Returns: minimal status JSON (ok, sent, timestamp)
 *
 * 2. /api/system/morning-brief
 *    - Triggered by: Manual browser visit or API call
 *    - Auth: Session (requires login)
 *    - Purpose: On-demand brief generation when owner wants it now
 *    - Returns: full brief text + sections + status
 *
 * Both call the SAME function: runMorningBrief() from autonomous-strategic-planner.ts
 * They are two ENTRY POINTS to the same logic, NOT duplicate implementations.
 */
import { NextResponse } from 'next/server'
import { runMorningBrief } from '@/lib/autonomous-strategic-planner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET() {
  const result = await runMorningBrief()
  return NextResponse.json({
    ok: result.ok,
    sent: result.sent,
    timestamp: new Date().toISOString(),
    error: result.error,
  })
}
