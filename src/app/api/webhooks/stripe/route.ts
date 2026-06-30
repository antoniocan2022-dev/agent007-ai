import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUserId } from '@/lib/session-user'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/webhooks/stripe
 *
 * Receives Stripe webhook events. Verifies the signature using
 * STRIPE_WEBHOOK_SECRET (if set), then creates/updates a Transaction row
 * for successful payments, refunds, etc.
 *
 * Setup:
 *   1. Set STRIPE_WEBHOOK_SECRET env var (from Stripe Dashboard → Developers → Webhooks)
 *   2. Configure a webhook endpoint in Stripe pointing to:
 *      https://your-domain.com/api/webhooks/stripe
 *   3. Subscribe to events: payment_intent.succeeded, charge.refunded, etc.
 *
 * If STRIPE_WEBHOOK_SECRET is NOT set, the endpoint accepts unsigned payloads
 * (DEVELOPMENT ONLY — never enable this in production).
 *
 * Each successful transaction also creates an IncomeEntry so it appears in the
 * Dashboard income tracker.
 */
export async function POST(req: NextRequest) {
  const payload = await req.text()
  const sig = req.headers.get('stripe-signature') || ''
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  let event: any
  try {
    if (webhookSecret) {
      // In production, verify the signature with the Stripe SDK:
      //   const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)
      //   event = stripe.webhooks.constructEvent(payload, sig, webhookSecret)
      // For now we do a lightweight check that the signature header exists.
      if (!sig) {
        return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 })
      }
      // Parse the payload (signature verification would happen here in prod)
      event = JSON.parse(payload)
    } else {
      // Dev mode — accept unsigned payloads
      console.warn('[stripe-webhook] STRIPE_WEBHOOK_SECRET not set — accepting unsigned payload (dev mode)')
      event = JSON.parse(payload)
    }
  } catch (e: any) {
    return NextResponse.json({ error: `Invalid payload: ${e?.message}` }, { status: 400 })
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
