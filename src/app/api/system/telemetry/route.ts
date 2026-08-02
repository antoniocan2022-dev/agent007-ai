/**
 * /api/system/telemetry — UPGRADE #218
 *
 * Returns recent mission telemetry records (per-mission data).
 * GET /api/system/telemetry → last 50 missions
 * GET /api/system/telemetry?limit=10 → last 10 missions
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const limit = parseInt(url.searchParams.get('limit') || '50')

  try {
    const records = await db.memory.findMany({
      where: { category: 'mission_telemetry' },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    const missions = records.map(r => {
      try { return JSON.parse(r.value) } catch { return null }
    }).filter(Boolean)

    return NextResponse.json({
      ok: true,
      count: missions.length,
      missions,
    })
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      error: e?.message,
      count: 0,
      missions: [],
    }, { status: 500 })
  }
}
