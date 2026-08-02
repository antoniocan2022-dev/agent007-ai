/**
 * /api/system/lifecycle — UPGRADE #221
 *
 * Returns mission lifecycle data — the 11-stage pipeline that every
 * mission must follow. Shows real-time status of each stage.
 *
 * GET /api/system/lifecycle → all lifecycle stages + recent missions
 */
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const LIFECYCLE_STAGES = [
  { id: 1, name: 'Mission Created', description: 'Mission request received and parsed', icon: 'FileText' },
  { id: 2, name: 'Mission Validated', description: 'Goal confirmed, constraints identified', icon: 'CheckCircle' },
  { id: 3, name: 'Dependencies Loaded', description: 'Required resources + APIs checked', icon: 'Link' },
  { id: 4, name: 'Context Loaded', description: 'Memory recalled, world model queried', icon: 'Database' },
  { id: 5, name: 'Leaders Assigned', description: 'Optimal leaders selected for the mission', icon: 'Users' },
  { id: 6, name: 'Execution', description: 'Leaders execute tasks in parallel', icon: 'Zap' },
  { id: 7, name: 'Verification', description: 'accuracy_checker verifies all claims', icon: 'ShieldCheck' },
  { id: 8, name: 'Quality Check', description: 'quality_scorer_v2 scores the output (≥92 required)', icon: 'Award' },
  { id: 9, name: 'Memory Update', description: 'Outcome stored in persistent memory', icon: 'Save' },
  { id: 10, name: 'Audit Log', description: 'Executive Audit Engine generates audit report', icon: 'ClipboardCheck' },
  { id: 11, name: 'Complete', description: 'Mission delivered to owner', icon: 'Flag' },
]

export async function GET() {
  try {
    // Get recent mission telemetry records
    const telemetryRecords = await db.memory.findMany({
      where: { category: 'mission_telemetry' },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }).catch(() => [])

    const recentMissions = telemetryRecords.map(r => {
      try { return JSON.parse(r.value) }
      catch { return null }
    }).filter(Boolean)

    return NextResponse.json({
      ok: true,
      stages: LIFECYCLE_STAGES,
      totalStages: LIFECYCLE_STAGES.length,
      recentMissions,
      recentCount: recentMissions.length,
    })
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      error: e?.message,
      stages: LIFECYCLE_STAGES,
      recentMissions: [],
    }, { status: 500 })
  }
}
