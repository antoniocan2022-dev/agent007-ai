import { NextRequest, NextResponse } from 'next/server'
import { getSessionUserId } from '@/lib/session-user'
import { listRecommendationReviews, recordRecommendationReview, type RecommendationReviewVerdict } from '@/lib/ceo-outcome-learning'

export const dynamic = 'force-dynamic'

const VALID_VERDICTS: readonly RecommendationReviewVerdict[] = ['REVIEWED', 'APPROVED', 'FLAGGED', 'CORRECTED', 'CLOSED']

/** Read-only inspection of every review recorded against a recommendation. */
export async function GET(req: NextRequest) {
  const userId = await getSessionUserId()
  if (!userId) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const recommendationId = new URL(req.url).searchParams.get('recommendationId')?.trim() ?? ''
  if (!recommendationId) return NextResponse.json({ ok: false, error: 'recommendationId is required' }, { status: 400 })
  const reviews = await listRecommendationReviews(recommendationId)
  return NextResponse.json({ ok: true, reviews })
}

// The owner-review action itself: reviewerId is always the authenticated session's own user id,
// never a client-supplied value -- a review must be attributable to whoever is actually signed in,
// the same discipline autonomy-graduation.ts's owner-approval flow already requires.
export async function POST(req: NextRequest) {
  const userId = await getSessionUserId()
  if (!userId) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const recommendationId = typeof body.recommendationId === 'string' ? body.recommendationId.trim() : ''
  const verdict = typeof body.verdict === 'string' ? body.verdict : ''
  if (!recommendationId) return NextResponse.json({ ok: false, error: 'recommendationId is required' }, { status: 400 })
  if (!VALID_VERDICTS.includes(verdict as RecommendationReviewVerdict)) return NextResponse.json({ ok: false, error: `verdict must be one of: ${VALID_VERDICTS.join(', ')}` }, { status: 400 })
  try {
    const review = await recordRecommendationReview({
      recommendationId,
      reviewerId: userId,
      verdict: verdict as RecommendationReviewVerdict,
      note: typeof body.note === 'string' ? body.note : undefined,
      evidenceRef: typeof body.evidenceRef === 'string' ? body.evidenceRef : undefined,
    })
    return NextResponse.json({ ok: true, review })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
