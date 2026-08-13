/**
 * /api/system/flywheel — Business Flywheel boundary.
 *
 * GET is read-only by default. Mutating execution requires authenticated POST,
 * or an explicit authenticated GET with ?execute=true for compatibility.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { runFlywheel, type FlywheelStage } from '@/lib/business-portfolio'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  if (url.searchParams.get('execute') !== 'true') {
    return NextResponse.json({
      ok: true,
      mode: 'read_only',
      stages: [
        'observe',
        'identify_opportunity',
        'estimate_value',
        'validate',
        'build_mvp',
        'acquire_customers',
        'learn',
        'automate',
        'scale',
        'standardize',
        'teach_organization',
      ],
      execution: 'Use authenticated POST to execute a Flywheel cycle.',
    })
  }
  return execute(req)
}

export async function POST(req: NextRequest) {
  return execute(req)
}

async function execute(req: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const stage = url.searchParams.get('stage') as FlywheelStage | null
  if (stage && ![
    'observe', 'identify_opportunity', 'estimate_value', 'validate', 'build_mvp',
    'acquire_customers', 'learn', 'automate', 'scale', 'standardize', 'teach_organization',
  ].includes(stage)) {
    return NextResponse.json({ ok: false, error: 'Invalid Flywheel stage.' }, { status: 400 })
  }

  const result = await runFlywheel(stage ? 'single' : 'full', stage || undefined)
  return NextResponse.json({ ok: result.status !== 'failed', ...result }, { status: result.status === 'failed' ? 500 : 200 })
}
