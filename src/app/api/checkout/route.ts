/**
 * /api/checkout — UPGRADE #127 + #150 (Consultant Plan + Recommendations)
 * Creates a real Stripe Checkout Session for a digital product.
 *
 * POST /api/checkout
 * Body: { productId: "50-ai-tools-guide" }
 *
 * Returns: { url: "https://checkout.stripe.com/c/..." }
 *
 * UPGRADE #150: Allow-list checkout. Only `50-ai-tools-guide` proceeds to
 * Stripe; the other 2 products return 503 "not ready yet". This prevents
 * charging real money for products that don't have real content yet.
 *
 * Recommendation #3: Launch pricing via Stripe coupon `LAUNCH50` (30% off,
 * limit 50 redemptions). Create this coupon in the Stripe Dashboard.
 * If the coupon exists, it's automatically applied; if not, full price.
 */
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { PRODUCTS, CHECKOUT_ALLOW_LIST } from '@/lib/product-fulfillment'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const stripeKey = process.env.STRIPE_SECRET_KEY

  if (!stripeKey) {
    return NextResponse.json(
      { ok: false, error: 'Stripe not configured. Set STRIPE_SECRET_KEY env var.' },
      { status: 503 }
    )
  }

  try {
    const body = await req.json().catch(() => ({}))
    const productId = body.productId || '50-ai-tools-guide'

    // UPGRADE #150 (Consultant Plan Step 5): Allow-list checkout.
    // Only products in CHECKOUT_ALLOW_LIST can proceed to Stripe.
    // Other products return 503 "not ready yet".
    if (!CHECKOUT_ALLOW_LIST.has(productId)) {
      return NextResponse.json(
        {
          ok: false,
          error: 'This product is not ready yet. We are currently only selling the 50 AI Tools Guide for Freelancers. Check back soon for the other products!',
          productId,
          availableProducts: Array.from(CHECKOUT_ALLOW_LIST),
        },
        { status: 503 }
      )
    }

    const product = PRODUCTS[productId]
    if (!product) {
      return NextResponse.json(
        { ok: false, error: `Unknown product: ${productId}. Available: ${Array.from(CHECKOUT_ALLOW_LIST).join(', ')}` },
        { status: 400 }
      )
    }

    const stripe = new Stripe(stripeKey!, { apiVersion: '2024-12-18.acacia' as any })

    // UPGRADE #150 (Recommendation #3): Try to apply the LAUNCH50 coupon.
    // If the coupon doesn't exist in Stripe, we silently fall back to full price.
    // Create the coupon in Stripe Dashboard:
    //   - Coupon ID: LAUNCH50
    //   - Percent off: 30 ($27 → $18.90)
    //   - Max redemptions: 50
    //   - Redeem by: 30 days from now
    let discounts: any[] | undefined
    try {
      const coupon = await stripe.coupons.retrieve('LAUNCH50')
      if (coupon.valid && !coupon.deleted) {
        discounts = [{ coupon: 'LAUNCH50' }]
        console.log('[checkout] Applying LAUNCH50 coupon (30% off, limit 50 redemptions)')
      }
    } catch {
      // Coupon doesn't exist — proceed at full price
      console.log('[checkout] LAUNCH50 coupon not found in Stripe — proceeding at full price ($27)')
    }

    // Create a real Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: product.name,
              description: product.description,
            },
            unit_amount: product.priceCents,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${req.headers.get('origin') || 'https://agent007-ai.vercel.app'}/success?session_id={CHECKOUT_SESSION_ID}&product=${productId}`,
      cancel_url: `${req.headers.get('origin') || 'https://agent007-ai.vercel.app'}/buy/${productId}?canceled=true`,
      metadata: {
        productId,
        productName: product.name,
        source: 'agent007-ai',
      },
      ...(discounts ? { discounts } : {}),
      // Collect the customer's email for fulfillment (download link)
      customer_email: body.customerEmail || undefined,
      // Ask Stripe to collect billing details so we have a name for the receipt
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
    })
  } catch (e: any) {
    console.error('[checkout] Stripe error:', e?.message?.slice(0, 200))
    return NextResponse.json(
      { ok: false, error: `Stripe error: ${e?.message?.slice(0, 150)}` },
      { status: 500 }
    )
  }
}

// GET returns the product catalog (for the buy page)
export async function GET() {
  return NextResponse.json({
    ok: true,
    products: Object.entries(PRODUCTS).map(([id, p]) => ({
      id,
      name: p.name,
      description: p.description,
      price: `$${(p.priceCents / 100).toFixed(2)}`,
      priceCents: p.priceCents,
      available: CHECKOUT_ALLOW_LIST.has(id),
    })),
    allowList: Array.from(CHECKOUT_ALLOW_LIST),
  })
}

