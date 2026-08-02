/**
 * /api/system/self-healing — UPGRADE #221
 *
 * Returns self-healing events — when leaders failed and the system
 * automatically recovered.
 *
 * GET /api/system/self-healing → recent healing events
 */
import { NextResponse } from 'next/server'
import { getRecentHealingEvents } from '@/lib/self-healing-engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET() {
  const events = await getRecentHealingEvents(50)
  return NextResponse.json({
    ok: true,
    count: events.length,
    events,
  })
}
