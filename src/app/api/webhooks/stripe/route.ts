import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import Stripe from 'stripe'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/webhooks/stripe
 *
 * Stripe is the source of truth for successful payment. The webhook is
 * signature-verified and owner-bound through Checkout Session metadata.
 * Webhooks have no user session, so this endpoint never falls back to an
 * arbitrary/seed user.
 */
export async function POST(req: NextRequest) {
  const payload = await req.text()
  const sig = req.headers.get('stripe-signature') || ''
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  const secretKey = process.env.STRIPE_SECRET_KEY

  if (!webhookSecret) {
    console.error('[stripe-webhook] REJECTED: STRIPE_WEBHOOK_SECRET not set.')
    return NextResponse.json({ error: 'Webhook secret not configured.' }, { status: 503 })
  }
  if (!secretKey) {
    return NextResponse.json({ error: 'Stripe secret key not configured.' }, { status: 503 })
  }
  if (!sig) return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 })

  let event: Stripe.Event
  try {
    const stripe = new Stripe(secretKey, { apiVersion: '2024-12-18.acacia' as any })
    event = stripe.webhooks.constructEvent(payload, sig, webhookSecret)
  } catch (e: any) {
    console.error('[stripe-webhook] SIGNATURE VERIFICATION FAILED:', e?.message?.slice(0, 200))
    return NextResponse.json({ error: `Signature verification failed: ${e?.message?.slice(0, 100)}` }, { status: 400 })
  }

  try {
    const eventType = event.type
    const data: any = event.data?.object

    if (eventType === 'checkout.session.completed') {
      const amount = (data.amount_total ?? 0) / 100
      const currency = (data.currency || 'usd').toUpperCase()
      const providerTxId = data.id
      const customerEmail = data.customer_details?.email
      const customerName = data.customer_details?.name
      const productId = data.metadata?.productId || 'unknown'
      const productName = data.metadata?.productName || 'Unknown Product'
      const paymentStatus = data.payment_status
      const metadataUserId = typeof data.metadata?.agent007UserId === 'string' ? data.metadata.agent007UserId : ''

      if (paymentStatus !== 'paid') {
        return NextResponse.json({ received: true, skipped: true, reason: `payment_status=${paymentStatus}` })
      }
      if (!metadataUserId) {
        console.error(`[stripe-webhook] Missing owner metadata for paid checkout ${providerTxId}`)
        return NextResponse.json({ error: 'Paid checkout is missing Agent007 owner metadata.' }, { status: 422 })
      }

      const owner = await db.user.findUnique({ where: { id: metadataUserId }, select: { id: true } })
      if (!owner) {
        console.error(`[stripe-webhook] Owner ${metadataUserId} not found for paid checkout ${providerTxId}`)
        return NextResponse.json({ error: 'Agent007 checkout owner not found.' }, { status: 422 })
      }

      const tx = await db.transaction.upsert({
        where: { provider_providerTxId: { provider: 'stripe', providerTxId } },
        update: {
          userId: owner.id,
          status: 'succeeded',
          amount,
          currency,
          customerEmail,
          customerName,
          description: `Product: ${productName} (ID: ${productId})`,
          rawPayload: payload.slice(0, 10000),
        },
        create: {
          userId: owner.id,
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

      await db.incomeEntry.create({
        data: {
          amount,
          source: 'stripe',
          notes: `Stripe Checkout — ${productName} (product: ${productId}, session: ${providerTxId})`,
          date: new Date(),
        },
      })

      let fulfillmentResult: { downloadUrl?: string; emailSent?: boolean; isFirstSale?: boolean } = {}
      if (customerEmail && productId !== 'unknown') {
        try {
          const { fulfillPurchase } = await import('@/lib/product-fulfillment')
          fulfillmentResult = await fulfillPurchase({ customerEmail, productId, amount, transactionId: providerTxId })
        } catch (fulfillErr: any) {
          console.error(`[stripe-webhook] Fulfillment FAILED for ${providerTxId}:`, fulfillErr?.message?.slice(0, 200))
        }
      }

      return NextResponse.json({
        received: true,
        transactionId: tx.id,
        product: productName,
        fulfilled: !!fulfillmentResult.downloadUrl,
        emailSent: fulfillmentResult.emailSent ?? false,
        isFirstSale: fulfillmentResult.isFirstSale ?? false,
      })
    }

    if (eventType === 'payment_intent.succeeded') {
      const amount = (data.amount_received ?? data.amount ?? 0) / 100
      const currency = (data.currency || 'usd').toUpperCase()
      const providerTxId = data.id
      const metadataUserId = typeof data.metadata?.agent007UserId === 'string' ? data.metadata.agent007UserId : ''
      if (!metadataUserId) return NextResponse.json({ received: true, skipped: true, reason: 'missing_owner_metadata' })
      const owner = await db.user.findUnique({ where: { id: metadataUserId }, select: { id: true } })
      if (!owner) return NextResponse.json({ error: 'Agent007 payment owner not found.' }, { status: 422 })

      const tx = await db.transaction.upsert({
        where: { provider_providerTxId: { provider: 'stripe', providerTxId } },
        update: { userId: owner.id, status: 'succeeded', amount, currency, rawPayload: payload.slice(0, 10000) },
        create: { userId: owner.id, provider: 'stripe', providerTxId, amount, currency, status: 'succeeded', rawPayload: payload.slice(0, 10000) },
      })
      return NextResponse.json({ received: true, transactionId: tx.id })
    }

    if (eventType === 'charge.refunded') {
      const providerTxId = data.id
      const amountRefunded = (data.amount_refunded ?? 0) / 100
      await db.transaction.updateMany({ where: { provider: 'stripe', providerTxId }, data: { status: 'refunded' } })
      if (amountRefunded > 0) {
        await db.incomeEntry.create({ data: { amount: -amountRefunded, source: 'stripe-refund', notes: `Stripe refund for ${providerTxId}`, date: new Date() } })
      }
      return NextResponse.json({ received: true, refunded: amountRefunded })
    }

    return NextResponse.json({ received: true, unhandled: eventType })
  } catch (e: any) {
    console.error('[stripe-webhook] error:', e)
    return NextResponse.json({ error: e?.message ?? 'Webhook failed' }, { status: 500 })
  }
}
