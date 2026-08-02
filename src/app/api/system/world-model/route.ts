/**
 * /api/system/world-model — UPGRADE #212
 *
 * Returns the current World Model snapshot — Agent007's structured
 * understanding of Antonio's business reality.
 *
 * GET /api/system/world-model → full snapshot
 * GET /api/system/world-model?summary=text → text summary
 */
import { NextRequest, NextResponse } from 'next/server'
import { getWorldModelSnapshot, getWorldModelSummary } from '@/lib/world-model'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const format = url.searchParams.get('summary')

  if (format === 'text') {
    const summary = await getWorldModelSummary()
    return NextResponse.json({ ok: true, summary })
  }

  const snapshot = await getWorldModelSnapshot()
  return NextResponse.json({ ok: true, ...snapshot })
}
