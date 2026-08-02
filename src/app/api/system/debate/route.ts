/**
 * /api/system/debate — UPGRADE #209
 *
 * Leader Debate Protocol endpoint.
 * Dispatches multiple leaders to debate a high-stakes question,
 * then synthesizes their recommendations.
 *
 * GET /api/system/debate?topic=Should+I+invest+5K+in+Tesla&leaders=quantum,echo,legal
 */
import { NextRequest, NextResponse } from 'next/server'
import { runLeaderDebate } from '@/lib/leader-debate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const topic = url.searchParams.get('topic')
  const leadersParam = url.searchParams.get('leaders') || 'quantum,echo,legal'
  const leaders = leadersParam.split(',').map(l => l.trim()).filter(Boolean)

  if (!topic) {
    return NextResponse.json(
      { ok: false, error: 'Missing "topic" query parameter' },
      { status: 400 }
    )
  }

  const result = await runLeaderDebate(topic, leaders)
  return NextResponse.json({ ok: true, ...result })
}
