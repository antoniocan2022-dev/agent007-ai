/**
 * /api/checkout — UPGRADE #127 (Recommendation 1)
 * Creates a real Stripe Checkout Session for a digital product.
 *
 * POST /api/checkout
 * Body: { productId: "50-ai-tools-guide" }
 *
 * Returns: { url: "https://checkout.stripe.com/c/..." }
 *
 * This is the FIRST real revenue path in the system.
 * A customer visits /buy/50-ai-tools-guide → clicks Buy Now →
 * this endpoint creates a Stripe Checkout Session → customer pays →
 * Stripe webhook verifies the payment → IncomeEntry created.
 */
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Product catalog — defines what customers can buy
const PRODUCTS: Record<string, { name: string; description: string; price: number; image?: string }> = {
  '50-ai-tools-guide': {
    name: '50 AI Tools Guide for Freelancers',
    description: 'A comprehensive guide covering 50 AI tools that help freelancers save time, find clients, and increase income. Includes tool reviews, setup tutorials, and income-boosting strategies.',
    price: 2700, // $27.00 in cents
  },
  'affiliate-blog-network-kit': {
    name: 'Affiliate Blog Network Starter Kit',
    description: 'Complete kit to launch a 12-article affiliate blog network targeting AI tools. Includes keyword research, article templates, affiliate link strategy, and SEO checklist.',
    price: 4700, // $47.00
  },
  'saas-micro-tool-blueprint': {
    name: 'SaaS Micro-Tool Blueprint',
    description: 'Step-by-step blueprint for building and launching a $9/mo SaaS micro-tool. Includes tech stack recommendations, pricing strategy, Stripe integration guide, and marketing playbook.',
    price: 6700, // $67.00
  },
}

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
    const product = PRODUCTS[productId]

    if (!product) {
      return NextResponse.json(
        { ok: false, error: `Unknown product: ${productId}. Available: ${Object.keys(PRODUCTS).join(', ')}` },
        { status: 400 }
      )
    }

    const stripe = new Stripe(stripeKey, { apiVersion: '2024-12-18.acacia' as any })

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
            unit_amount: product.price,
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
    })

    return NextResponse.json({
      ok: true,
      url: session.url,
      sessionId: session.id,
      productId,
      productName: product.name,
      price: `$${(product.price / 100).toFixed(2)}`,
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
      price: `$${(p.price / 100).toFixed(2)}`,
      priceCents: p.price,
    })),
  })
}
