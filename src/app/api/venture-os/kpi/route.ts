import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { calculateOperationalKpis, persistOperationalKpiSnapshot } from '@/lib/operational-kpi-engine'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const ventureId = url.searchParams.get('ventureId')?.trim() || 'venture_001'
  const windowHours = Number(url.searchParams.get('windowHours') || 24)
  try {
    const snapshot = await calculateOperationalKpis(ventureId, windowHours)
    await persistOperationalKpiSnapshot(snapshot)
    return NextResponse.json({ ok: true, snapshot })
  } catch (error: unknown) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'KPI calculation failed' }, { status: 400 })
  }
}
