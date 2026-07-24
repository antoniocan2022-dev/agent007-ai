/**
 * /api/checkout/verify — UPGRADE #127
 * Verifies a Stripe Checkout Session after payment.
 *
 * GET /api/checkout/verify?session_id=cs_test_123
 *
 * Returns the session details + payment status from Stripe's API.
 * Used by the /success page to confirm the payment was real.
 */
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) {
    return NextResponse.json({ ok: false, error: 'Stripe not configured' }, { status: 503 })
  }

  const url = new URL(req.url)
  const sessionId = url.searchParams.get('session_id')

  if (!sessionId) {
    return NextResponse.json({ ok: false, error: 'session_id required' }, { status: 400 })
  }

  try {
    const stripe = new Stripe(stripeKey, { apiVersion: '2024-12-18.acacia' as any })
    const session = await stripe.checkout.sessions.retrieve(sessionId)

    return NextResponse.json({
      ok: true,
      paymentStatus: session.payment_status,
      session: {
        id: session.id,
        amount_total: session.amount_total,
        currency: session.currency,
        payment_status: session.payment_status,
        customer_email: session.customer_details?.email,
        metadata: session.metadata,
      },
    })
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: `Stripe error: ${e?.message?.slice(0, 150)}` },
      { status: 500 }
    )
  }
}
