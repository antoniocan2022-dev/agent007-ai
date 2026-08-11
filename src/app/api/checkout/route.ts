/**
 * /api/checkout — Creates a real Stripe Checkout Session for a digital product.
 *
 * Checkout is host-independent: public success/cancel URLs come from the
 * configured application URL or the current trusted request origin.
 */
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { PRODUCTS, CHECKOUT_ALLOW_LIST } from '@/lib/product-fulfillment'
import { getSessionUser } from '@/lib/session-user'
import { getPublicBaseUrlFromRequest } from '@/lib/runtime/public-base-url'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const stripeKey = process.env.STRIPE_SECRET_KEY

  if (!stripeKey) {
    return NextResponse.json({ ok: false, error: 'Stripe not configured. Set STRIPE_SECRET_KEY env var.' }, { status: 503 })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const productId = body.productId || '50-ai-tools-guide'
    const revenueCorrelationId = typeof body.revenueCorrelationId === 'string' ? body.revenueCorrelationId.trim() : ''

    if (!CHECKOUT_ALLOW_LIST.has(productId)) {
      return NextResponse.json(
        { ok: false, error: 'This product is not ready yet. We are currently only selling the 50 AI Tools Guide for Freelancers. Check back soon for the other products!', productId, availableProducts: Array.from(CHECKOUT_ALLOW_LIST) },
        { status: 503 },
      )
    }

    const product = PRODUCTS[productId]
    if (!product) return NextResponse.json({ ok: false, error: `Unknown product: ${productId}.` }, { status: 400 })

    const owner = await getSessionUser()
    if (!owner) {
      return NextResponse.json({ ok: false, error: 'Authentication required to create an Agent007 checkout.' }, { status: 401 })
    }

    const stripe = new Stripe(stripeKey, { apiVersion: '2024-12-18.acacia' as any })
    const publicBaseUrl = getPublicBaseUrlFromRequest(req)

    let discounts: Stripe.Checkout.SessionCreateParams.Discount[] | undefined
    try {
      const coupon = await stripe.coupons.retrieve('LAUNCH50')
      if (coupon.valid && !coupon.deleted) discounts = [{ coupon: 'LAUNCH50' }]
    } catch {
      // Optional launch coupon; checkout remains valid at full price.
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: product.name, description: product.description },
          unit_amount: product.priceCents,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${publicBaseUrl}/success?session_id={CHECKOUT_SESSION_ID}&product=${encodeURIComponent(productId)}`,
      cancel_url: `${publicBaseUrl}/buy/${encodeURIComponent(productId)}?canceled=true`,
      metadata: {
        productId,
        productName: product.name,
        source: 'agent007-ai',
        agent007UserId: owner.id,
        ...(revenueCorrelationId ? { revenueCorrelationId } : {}),
      },
      ...(discounts ? { discounts } : {}),
      customer_email: body.customerEmail || undefined,
      billing_address_collection: 'auto',
    })

    return NextResponse.json({
      ok: true,
      url: session.url,
      sessionId: session.id,
      productId,
      productName: product.name,
      price: `$${(product.priceCents / 100).toFixed(2)}`,
      appliedCoupon: discounts ? 'LAUNCH50' : null,
      ownerBound: true,
      revenueCorrelationBound: !!revenueCorrelationId,
    })
  } catch (e: any) {
    console.error('[checkout] Stripe error:', e?.message?.slice(0, 200))
    return NextResponse.json({ ok: false, error: `Stripe error: ${e?.message?.slice(0, 150)}` }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    products: Object.entries(PRODUCTS).map(([id, p]) => ({ id, name: p.name, description: p.description, price: `$${(p.priceCents / 100).toFixed(2)}`, priceCents: p.priceCents, available: CHECKOUT_ALLOW_LIST.has(id) })),
    allowList: Array.from(CHECKOUT_ALLOW_LIST),
  })
}
