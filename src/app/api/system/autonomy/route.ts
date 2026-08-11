import { NextResponse } from 'next/server'
import { getAutonomyTelemetrySummary } from '@/lib/mission-telemetry'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * GET /api/system/autonomy
 *
 * Canonical read-only view of Agent007's evidence-driven autonomy status.
 * The endpoint intentionally exposes both the score and its evidence gates so
 * a high aggregate score can never be mistaken for production authorization.
 */
export async function GET() {
  const startedAt = Date.now()

  try {
    const summary = await getAutonomyTelemetrySummary()

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      elapsed_ms: Date.now() - startedAt,
      autonomy: summary.index,
      evidence_coverage: summary.evidenceCoverage,
      eligible_missions: summary.eligibleMissions,
      policy: {
        note: 'The Autonomy Index is an evidence and reliability measure. It does not grant authority to bypass the Autonomy Governor.',
      },
    })
  } catch (error: any) {
    return NextResponse.json({
      ok: false,
      error: error?.message ?? 'Failed to calculate autonomy status',
      elapsed_ms: Date.now() - startedAt,
    }, { status: 500 })
  }
}
