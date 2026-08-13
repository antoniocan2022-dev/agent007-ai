/**
 * /api/system/venture-decision — CEO Venture decision boundary.
 *
 * GET is read-only and exposes current policy contracts.
 * POST requires an authenticated operator before recording evidence or
 * applying portfolio lifecycle decisions. External launch evidence must be
 * recorded explicitly; the endpoint never fabricates it.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { CEO_VENTURE_MANDATE, validateVentureMandate } from '@/lib/venture-mandate'
import { isScorecardContractValid, VENTURE_SCORECARD_VERSION } from '@/lib/venture-scorecard'
import {
  applyAutonomousVentureDecision,
  evaluateVentureDecision,
  finalizeVerifiedLaunch,
  recordLaunchVerification,
  recordVentureEvidence,
  runAutonomousVentureCycle,
  VENTURE_DECISION_ENGINE_VERSION,
} from '@/lib/venture-decision-engine'

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
    validation: { mandateErrors, scorecardErrors },
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

  const action = typeof body?.action === 'string' ? body.action : 'evaluate'

  if (action === 'cycle') {
    return NextResponse.json({ ok: true, cycle: await runAutonomousVentureCycle() })
  }

  const businessId = typeof body?.businessId === 'string' ? body.businessId.trim() : ''
  if (!businessId) return NextResponse.json({ ok: false, error: 'Missing businessId' }, { status: 400 })

  if (action === 'record_evidence') {
    const evidence = body?.evidence
    if (!evidence || typeof evidence !== 'object') return NextResponse.json({ ok: false, error: 'Missing evidence object' }, { status: 400 })
    try {
      const record = await recordVentureEvidence({
        businessId,
        kind: evidence.kind ?? 'other',
        source: String(evidence.source ?? ''),
        statement: String(evidence.statement ?? ''),
        confidence: Number(evidence.confidence ?? 0),
        verified: evidence.verified === true,
      })
      return NextResponse.json({ ok: true, evidence: record })
    } catch (error) {
      return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Evidence recording failed.' }, { status: 400 })
    }
  }

  if (action === 'verify_launch') {
    const verification = body?.verification
    if (!verification || typeof verification !== 'object') return NextResponse.json({ ok: false, error: 'Missing verification object' }, { status: 400 })
    try {
      const record = await recordLaunchVerification(businessId, {
        source: String(verification.source ?? ''),
        statement: String(verification.statement ?? ''),
        confidence: Number(verification.confidence ?? 0),
        verifiedAt: typeof verification.verifiedAt === 'string' ? verification.verifiedAt : undefined,
      })
      const finalized = await finalizeVerifiedLaunch(businessId)
      return NextResponse.json({ ok: true, evidence: record, finalized })
    } catch (error) {
      return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Launch verification failed.' }, { status: 400 })
    }
  }

  const decision = await evaluateVentureDecision({
    businessId,
    opportunity: body?.opportunity,
    health: body?.health,
    launchVerified: body?.launchVerified === true,
    requestedSpend: typeof body?.requestedSpend === 'number' ? body.requestedSpend : undefined,
    monthlyCommittedSpend: typeof body?.monthlyCommittedSpend === 'number' ? body.monthlyCommittedSpend : undefined,
  })

  if (action === 'apply' || body?.applyAutonomous === true) {
    const applied = await applyAutonomousVentureDecision(decision)
    return NextResponse.json({ ok: true, decision, applied })
  }

  return NextResponse.json({ ok: true, decision })
}
