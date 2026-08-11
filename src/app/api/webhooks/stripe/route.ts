import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import Stripe from 'stripe'
import { hasFulfillmentCompleted, markFulfillmentCompleted, markFulfillmentPending, stripeIncomeReference } from '@/lib/revenue-integrity'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function safeJson(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

async function ensureIncomeEntry(opts: { amount: number; source: string; notes: string }) {
  const existing = await db.incomeEntry.findFirst({ where: { source: opts.source, notes: opts.notes } })
  if (existing) return { created: false, id: existing.id }
  try {
    const created = await db.incomeEntry.create({ data: { ...opts, date: new Date() } })
    return { created: true, id: created.id }
  } catch {
    const retry = await db.incomeEntry.findFirst({ where: { source: opts.source, notes: opts.notes } })
    if (retry) return { created: false, id: retry.id }
    throw new Error('Unable to establish the derived income ledger entry')
  }
}

async function persistFulfillmentState(transactionId: string, payload: string, status: 'completed' | 'pending_retry', error?: string) {
  const nextPayload = status === 'completed' ? markFulfillmentCompleted(payload) : markFulfillmentPending(payload, error)
  await db.transaction.update({ where: { id: transactionId }, data: { rawPayload: nextPayload } })
}

export async function POST(req: NextRequest) {
  const payload = await req.text()
  const sig = req.headers.get('stripe-signature') || ''
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  const secretKey = process.env.STRIPE_SECRET_KEY

  if (!webhookSecret) return NextResponse.json({ error: 'Webhook secret not configured.' }, { status: 503 })
  if (!secretKey) return NextResponse.json({ error: 'Stripe secret key not configured.' }, { status: 503 })
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
    const data = safeJson(event.data?.object)

    if (event.type === 'checkout.session.completed') {
      const amount = Number(data.amount_total ?? 0) / 100
      const currency = String(data.currency || 'usd').toUpperCase()
      const providerTxId = typeof data.payment_intent === 'string' ? data.payment_intent : String(data.id)
      const checkoutSessionId = String(data.id)
      const customerDetails = safeJson(data.customer_details)
      const customerEmail = typeof customerDetails.email === 'string' ? customerDetails.email : undefined
      const customerName = typeof customerDetails.name === 'string' ? customerDetails.name : undefined
      const metadata = safeJson(data.metadata)
      const productId = typeof metadata.productId === 'string' ? metadata.productId : 'unknown'
      const productName = typeof metadata.productName === 'string' ? metadata.productName : 'Unknown Product'
      const paymentStatus = String(data.payment_status || '')
      const metadataUserId = typeof metadata.agent007UserId === 'string' ? metadata.agent007UserId : ''

      if (paymentStatus !== 'paid') return NextResponse.json({ received: true, skipped: true, reason: `payment_status=${paymentStatus}` })
      if (!metadataUserId) return NextResponse.json({ error: 'Paid checkout is missing Agent007 owner metadata.' }, { status: 422 })

      const owner = await db.user.findUnique({ where: { id: metadataUserId }, select: { id: true } })
      if (!owner) return NextResponse.json({ error: 'Agent007 checkout owner not found.' }, { status: 422 })

      const existing = await db.transaction.findUnique({
        where: { provider_providerTxId: { provider: 'stripe', providerTxId } },
      })

      const transaction = existing
        ? await db.transaction.update({ where: { id: existing.id }, data: { userId: owner.id, status: 'succeeded', amount, currency, customerEmail, customerName, productName, description: `Product: ${productName} (ID: ${productId})`, rawPayload: existing.rawPayload || payload.slice(0, 10000) } })
        : await db.transaction.create({ data: { userId: owner.id, provider: 'stripe', providerTxId, amount, currency, status: 'succeeded', customerEmail, customerName, productName, description: `Product: ${productName} (ID: ${productId})`, rawPayload: payload.slice(0, 10000) } })

      const incomeNotes = `Stripe Checkout — ${productName} (product: ${productId}, session: ${checkoutSessionId}, payment_intent: ${providerTxId})`
      await ensureIncomeEntry({ amount, source: stripeIncomeReference('sale', providerTxId), notes: incomeNotes })

      let fulfillmentResult: { downloadUrl?: string; emailSent?: boolean; isFirstSale?: boolean } = {}
      if (customerEmail && productId !== 'unknown' && !hasFulfillmentCompleted(transaction.rawPayload)) {
        try {
          const { fulfillPurchase } = await import('@/lib/product-fulfillment')
          fulfillmentResult = await fulfillPurchase({ customerEmail, productId, amount, transactionId: providerTxId })
          if (fulfillmentResult.emailSent) {
            await persistFulfillmentState(transaction.id, transaction.rawPayload, 'completed')
          } else {
            await persistFulfillmentState(transaction.id, transaction.rawPayload, 'pending_retry', 'fulfillment email was not confirmed')
          }
        } catch (error: any) {
          await persistFulfillmentState(transaction.id, transaction.rawPayload, 'pending_retry', error?.message || 'fulfillment failed')
          console.error(`[stripe-webhook] Fulfillment failed for ${checkoutSessionId}:`, error?.message?.slice(0, 200))
        }
      }

      return NextResponse.json({ received: true, duplicate: !!existing, transactionId: transaction.id, product: productName, fulfilled: !!fulfillmentResult.downloadUrl, emailSent: fulfillmentResult.emailSent ?? false, isFirstSale: fulfillmentResult.isFirstSale ?? false })
    }

    if (event.type === 'payment_intent.succeeded') {
      const amount = Number(data.amount_received ?? data.amount ?? 0) / 100
      const currency = String(data.currency || 'usd').toUpperCase()
      const providerTxId = String(data.id)
      const metadata = safeJson(data.metadata)
      const metadataUserId = typeof metadata.agent007UserId === 'string' ? metadata.agent007UserId : ''
      if (!metadataUserId) return NextResponse.json({ received: true, skipped: true, reason: 'missing_owner_metadata' })

      const owner = await db.user.findUnique({ where: { id: metadataUserId }, select: { id: true } })
      if (!owner) return NextResponse.json({ error: 'Agent007 payment owner not found.' }, { status: 422 })

      const existing = await db.transaction.findUnique({ where: { provider_providerTxId: { provider: 'stripe', providerTxId } } })
      const transaction = existing
        ? await db.transaction.update({ where: { id: existing.id }, data: { userId: owner.id, status: 'succeeded', amount, currency, rawPayload: existing.rawPayload || payload.slice(0, 10000) } })
        : await db.transaction.create({ data: { userId: owner.id, provider: 'stripe', providerTxId, amount, currency, status: 'succeeded', rawPayload: payload.slice(0, 10000) } })

      await ensureIncomeEntry({ amount, source: stripeIncomeReference('sale', providerTxId), notes: `Stripe PaymentIntent — ${providerTxId}` })
      return NextResponse.json({ received: true, duplicate: !!existing, transactionId: transaction.id })
    }

    if (event.type === 'charge.refunded') {
      const providerTxId = typeof data.payment_intent === 'string' ? data.payment_intent : ''
      const amountRefunded = Number(data.amount_refunded ?? 0) / 100
      if (!providerTxId) return NextResponse.json({ received: true, skipped: true, reason: 'refund_missing_payment_intent' })

      const existing = await db.transaction.findUnique({ where: { provider_providerTxId: { provider: 'stripe', providerTxId } }, select: { id: true, status: true } })
      if (!existing) return NextResponse.json({ received: true, skipped: true, reason: 'transaction_not_found' })

      const alreadyRefunded = existing.status === 'refunded'
      await db.transaction.update({ where: { id: existing.id }, data: { status: 'refunded' } })
      if (amountRefunded > 0) {
        await ensureIncomeEntry({ amount: -amountRefunded, source: stripeIncomeReference('refund', providerTxId), notes: `Stripe refund for PaymentIntent ${providerTxId}` })
      }
      return NextResponse.json({ received: true, refunded: amountRefunded, duplicate: alreadyRefunded })
    }

    return NextResponse.json({ received: true, unhandled: event.type })
  } catch (e: any) {
    console.error('[stripe-webhook] error:', e)
    return NextResponse.json({ error: e?.message ?? 'Webhook failed' }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: '/api/webhooks/stripe', signatureRequired: true })
}
