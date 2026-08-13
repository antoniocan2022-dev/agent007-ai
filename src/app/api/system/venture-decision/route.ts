/**
 * /api/system/venture-decision — CEO Venture decision boundary.
 *
 * GET is read-only and exposes the current policy contracts.
 * POST requires an authenticated operator before evaluating/applying a
 * portfolio decision. No endpoint here fabricates external launch evidence.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { CEO_VENTURE_MANDATE, validateVentureMandate } from '@/lib/venture-mandate'
import { isScorecardContractValid, VENTURE_SCORECARD_VERSION } from '@/lib/venture-scorecard'
import { applyAutonomousVentureDecision, evaluateVentureDecision, VENTURE_DECISION_ENGINE_VERSION } from '@/lib/venture-decision-engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET() {
  const mandateErrors = validateVentureMandate()
  const scorecardErrors = isScorecardContractValid()
  return NextResponse.json({
    ok: mandateErrors.length === 0 && scorecardErrors.length === 0,
    engineVersion: VENTURE_DECISION_ENGINE_VERSION,
    scorecardVersion: VENTURE_SCORECARD_VERSION,
    mandate: CEO_VENTURE_MANDATE,
    validation: {
      mandateErrors,
      scorecardErrors,
    },
  }, {
    status: mandateErrors.length === 0 && scorecardErrors.length === 0 ? 200 : 500,
  })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const businessId = typeof body?.businessId === 'string' ? body.businessId.trim() : ''
  if (!businessId) return NextResponse.json({ ok: false, error: 'Missing businessId' }, { status: 400 })

  const decision = await evaluateVentureDecision({
    businessId,
    opportunity: body?.opportunity,
    health: body?.health,
    launchVerified: body?.launchVerified === true,
    requestedSpend: typeof body?.requestedSpend === 'number' ? body.requestedSpend : undefined,
    monthlyCommittedSpend: typeof body?.monthlyCommittedSpend === 'number' ? body.monthlyCommittedSpend : undefined,
  })

  if (body?.applyAutonomous === true) {
    const applied = await applyAutonomousVentureDecision(decision)
    return NextResponse.json({ ok: true, decision, applied })
  }

  return NextResponse.json({ ok: true, decision })
}
