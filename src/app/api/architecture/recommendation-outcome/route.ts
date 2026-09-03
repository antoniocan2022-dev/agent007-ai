import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getRecommendationOutcomeCorrelation } from '@/lib/ceo-outcome-learning'

export const dynamic = 'force-dynamic'

/** Read-only inspection of the canonical recommendation → action → outcome chain. */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const correlationId = new URL(req.url).searchParams.get('correlationId')?.trim() ?? ''
  if (!correlationId) return NextResponse.json({ ok: false, error: 'correlationId is required' }, { status: 400 })
  try {
    const correlation = await getRecommendationOutcomeCorrelation(correlationId)
    return NextResponse.json({ ok: true, correlation })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
