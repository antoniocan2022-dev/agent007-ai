import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUserId } from '@/lib/session-user'
import Stripe from 'stripe'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/webhooks/stripe — UPGRADE #121 (CRITICAL SECURITY FIX)
 *
 * Receives Stripe webhook events. Verifies the signature using the
 * Stripe SDK + STRIPE_WEBHOOK_SECRET. FAILS CLOSED if the secret is
 * not set or the signature is invalid.
 *
 * SECURITY: This endpoint NO LONGER accepts unsigned payloads.
 * Anyone who finds this URL cannot forge fake payment events.
 *
 * Setup:
 *   1. Set STRIPE_WEBHOOK_SECRET env var (from Stripe Dashboard → Developers → Webhooks)
 *   2. Set STRIPE_SECRET_KEY env var (for the SDK to initialize)
 *   3. Configure a webhook endpoint in Stripe pointing to:
 *      https://agent007-ai.vercel.app/api/webhooks/stripe
 *   4. Subscribe to events: payment_intent.succeeded, charge.refunded, etc.
 */
export async function POST(req: NextRequest) {
  const payload = await req.text()
  const sig = req.headers.get('stripe-signature') || ''
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  const secretKey = process.env.STRIPE_SECRET_KEY

  // ── UPGRADE #121: FAIL-CLOSED if webhook secret is not set ──
  if (!webhookSecret) {
    console.error('[stripe-webhook] REJECTED: STRIPE_WEBHOOK_SECRET not set. Webhook verification impossible.')
    return NextResponse.json(
      { error: 'Webhook secret not configured. Set STRIPE_WEBHOOK_SECRET env var.' },
      { status: 503 }
    )
  }

  if (!sig) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 })
  }

  // ── UPGRADE #121: REAL signature verification using the Stripe SDK ──
  let event: Stripe.Event
  try {
    const stripe = new Stripe(secretKey || '', { apiVersion: '2024-12-18.acacia' as any })
    event = stripe.webhooks.constructEvent(payload, sig, webhookSecret)
  } catch (e: any) {
    console.error('[stripe-webhook] SIGNATURE VERIFICATION FAILED:', e?.message?.slice(0, 200))
    return NextResponse.json(
      { error: `Signature verification failed: ${e?.message?.slice(0, 100)}` },
      { status: 400 }
    )
  }

  // Determine the user — Stripe webhooks don't carry our session, so we
  // match by customer email OR default to the seed user. In production you'd
  // store the userId in Stripe metadata at checkout time.
  const fallbackUserId = await getSessionUserId()
  if (!fallbackUserId) {
    return NextResponse.json({ error: 'No user available' }, { status: 500 })
  }

  try {
    // Handle the event
    const eventType: string = event.type
    const data: any = event.data?.object

    if (eventType === 'payment_intent.succeeded' || eventType === 'charge.succeeded') {
      const amount = (data.amount_received ?? data.amount ?? 0) / 100 // Stripe uses cents
      const currency = (data.currency || 'usd').toUpperCase()
      const providerTxId = data.id
      const customerEmail = data.receipt_email || data.billing_details?.email
      const customerName = data.billing_details?.name
      const description = data.description

      // Try to find the user by customer email
      let userId = fallbackUserId
      if (customerEmail) {
        const u = await db.user.findUnique({ where: { email: customerEmail.toLowerCase() } })
        if (u) userId = u.id
      }

      // Idempotent insert (unique on [provider, providerTxId])
      const tx = await db.transaction.upsert({
        where: { provider_providerTxId: { provider: 'stripe', providerTxId } },
        update: {
          status: 'succeeded',
          amount,
          currency,
          customerEmail,
          customerName,
          description,
          rawPayload: payload.slice(0, 10000),
        },
        create: {
          userId,
          provider: 'stripe',
          providerTxId,
          amount,
          currency,
          status: 'succeeded',
          customerEmail,
          customerName,
          description,
          rawPayload: payload.slice(0, 10000),
        },
      })

      // Also log to IncomeEntry so it shows in the dashboard
      await db.incomeEntry.create({
        data: {
          amount,
          source: 'stripe',
          notes: `Stripe payment ${providerTxId}${description ? ` — ${description}` : ''}`,
          date: new Date(),
        },
      })

      console.log(`[stripe-webhook] Logged payment ${providerTxId}: $${amount} ${currency}`)
      return NextResponse.json({ received: true, transactionId: tx.id })
    }

    // UPGRADE #130: Handle checkout.session.completed — carries product metadata
    // This fires when a Stripe Checkout Session is completed (from /api/checkout)
    if (eventType === 'checkout.session.completed') {
      const amount = (data.amount_total ?? 0) / 100
      const currency = (data.currency || 'usd').toUpperCase()
      const providerTxId = data.id
      const customerEmail = data.customer_details?.email
      const customerName = data.customer_details?.name
      const productId = data.metadata?.productId || 'unknown'
      const productName = data.metadata?.productName || 'Unknown Product'
      const paymentStatus = data.payment_status

      if (paymentStatus !== 'paid') {
        console.log(`[stripe-webhook] Checkout session ${providerTxId} status: ${paymentStatus} — skipping`)
        return NextResponse.json({ received: true, skipped: true, reason: `payment_status=${paymentStatus}` })
      }

      // Try to find the user by customer email
      let userId = fallbackUserId
      if (customerEmail) {
        const u = await db.user.findUnique({ where: { email: customerEmail.toLowerCase() } })
        if (u) userId = u.id
      }

      // Create transaction with product metadata
      const tx = await db.transaction.upsert({
        where: { provider_providerTxId: { provider: 'stripe', providerTxId } },
        update: {
          status: 'succeeded',
          amount,
          currency,
          customerEmail,
          customerName,
          description: `Product: ${productName} (ID: ${productId})`,
          rawPayload: payload.slice(0, 10000),
        },
        create: {
          userId,
          provider: 'stripe',
          providerTxId,
          amount,
          currency,
          status: 'succeeded',
          customerEmail,
          customerName,
          description: `Product: ${productName} (ID: ${productId})`,
          rawPayload: payload.slice(0, 10000),
        },
      })

      // Log to IncomeEntry WITH product attribution
      await db.incomeEntry.create({
        data: {
          amount,
          source: 'stripe',
          notes: `Stripe Checkout — ${productName} (product: ${productId}, session: ${providerTxId})`,
          date: new Date(),
        },
      })

      console.log(`[stripe-webhook] Logged checkout ${providerTxId}: $${amount} ${currency} — ${productName}`)
      return NextResponse.json({ received: true, transactionId: tx.id, product: productName })
    }

    if (eventType === 'charge.refunded') {
      const providerTxId = data.id
      const amountRefunded = (data.amount_refunded ?? 0) / 100
      await db.transaction.updateMany({
        where: { provider: 'stripe', providerTxId },
        data: { status: 'refunded' },
      })
      // Log a negative income entry for the refund
      await db.incomeEntry.create({
        data: {
          amount: -amountRefunded,
          source: 'stripe-refund',
          notes: `Stripe refund for ${providerTxId}`,
          date: new Date(),
        },
      })
      return NextResponse.json({ received: true, refunded: amountRefunded })
    }

    // Unhandled event type — acknowledge so Stripe doesn't retry
    return NextResponse.json({ received: true, unhandled: eventType })
  } catch (e: any) {
    console.error('[stripe-webhook] error:', e)
    return NextResponse.json({ error: e?.message ?? 'Webhook failed' }, { status: 500 })
  }
}
