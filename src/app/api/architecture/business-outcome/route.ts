import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { assertVentureActionAllowed, recordBusinessOutcome, type BusinessOutcomeType } from '@/lib/architecture-control-plane'
import { recordObservedRecommendationOutcome } from '@/lib/ceo-outcome-learning'

export const dynamic = 'force-dynamic'

const OUTCOME_TYPES = new Set<BusinessOutcomeType>(['TRANSACTION', 'CUSTOMER_ACQUIRED', 'REVENUE_RECOGNIZED', 'REFUND', 'COST_RECORDED', 'KPI_SNAPSHOT'])

export async function POST(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const ventureId = typeof body.ventureId === 'string' ? body.ventureId.trim() : ''
  const type = typeof body.type === 'string' ? body.type.trim() : ''
  const source = typeof body.source === 'string' ? body.source.trim() : ''
  const occurredAt = typeof body.occurredAt === 'string' ? body.occurredAt : new Date().toISOString()
  if (!ventureId || !type || !source) return NextResponse.json({ ok: false, error: 'ventureId, type and source are required' }, { status: 400 })
  if (!OUTCOME_TYPES.has(type as BusinessOutcomeType)) return NextResponse.json({ ok: false, error: `Unsupported business outcome type: ${type}` }, { status: 400 })

  try {
    await assertVentureActionAllowed(ventureId, 'record_outcome')
    const metadata = body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata) ? { ...body.metadata } as Record<string, unknown> : {}
    const recommendationId = typeof body.recommendationId === 'string' ? body.recommendationId.trim() : typeof body.correlationId === 'string' ? body.correlationId.trim() : typeof metadata.recommendationCorrelationId === 'string' ? String(metadata.recommendationCorrelationId).trim() : ''
    if (recommendationId) metadata.recommendationCorrelationId = recommendationId
    const amount = typeof body.amount === 'number' ? body.amount : null
    const currency = typeof body.currency === 'string' ? body.currency : null
    const actualResult = typeof body.actualResult === 'string' ? body.actualResult.trim() : amount !== null ? `${amount} ${currency ?? ''}`.trim() : `${type} observed`
    const observedOutcome = typeof body.observedOutcome === 'string' ? body.observedOutcome.trim() : `${type} observed`
    const outcome = await recordBusinessOutcome({
      ventureId,
      missionId: typeof body.missionId === 'string' ? body.missionId : null,
      type: type as BusinessOutcomeType,
      transactionId: typeof body.transactionId === 'string' ? body.transactionId : null,
      customerId: typeof body.customerId === 'string' ? body.customerId : null,
      amount,
      currency,
      source,
      occurredAt,
      metadata,
    })
    if (recommendationId) {
      await recordObservedRecommendationOutcome({
        recommendationId,
        observedOutcome,
        actualResult,
        observedAt: Date.parse(outcome.occurredAt),
        source,
        metadata: { ...metadata, businessOutcomeId: outcome.outcomeId, businessOutcomeType: outcome.type, ventureId: outcome.ventureId },
      })
    }
    return NextResponse.json({ ok: true, outcome, recommendationCorrelationId: recommendationId || null })
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message ?? 'Business outcome rejected' }, { status: 400 })
  }
}
