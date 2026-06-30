import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUserId } from '@/lib/session-user'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/webhooks/paypal
 *
 * Receives PayPal webhook events. PayPal sends JSON directly (no signature
 * verification by default — for production you should verify via the
 * PayPal API's verify-webhook-signature endpoint using PAYPAL_CLIENT_ID,
 * PAYPAL_CLIENT_SECRET, and the webhook ID).
 *
 * Setup:
 *   1. Set PAYPAL_CLIENT_ID + PAYPAL_CLIENT_SECRET env vars
 *   2. Configure a webhook in PayPal Developer Dashboard → My Apps → your app
 *   3. Subscribe to: PAYMENT.CAPTURE.COMPLETED, PAYMENT.CAPTURE.REFUNDED
 *
 * Each successful transaction also creates an IncomeEntry so it appears in the
 * Dashboard income tracker.
 */
export async function POST(req: NextRequest) {
  let event: any
  try {
    event = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const eventType: string = event.event_type || ''
  const resource: any = event.resource

  const fallbackUserId = await getSessionUserId()
  if (!fallbackUserId) {
    return NextResponse.json({ error: 'No user available' }, { status: 500 })
  }

  try {
    if (eventType === 'PAYMENT.CAPTURE.COMPLETED') {
      const amount = parseFloat(resource?.amount?.value || '0')
      const currency = (resource?.amount?.currency_code || 'USD').toUpperCase()
      const providerTxId = resource?.id || event.id
      const customId = resource?.custom_id // could carry userId
      const customerEmail = resource?.payer?.email_address || resource?.billing_agreement_id
      const customerName =
        resource?.payer?.name
          ? `${resource.payer.name.given_name || ''} ${resource.payer.name.surname || ''}`.trim()
          : undefined
      const description = resource?.description || resource?.note_to_payer

      // Try to find the user by customId or email
      let userId = fallbackUserId
      if (customerEmail) {
        const u = await db.user.findUnique({ where: { email: customerEmail.toLowerCase() } })
        if (u) userId = u.id
      }

      const tx = await db.transaction.upsert({
        where: { provider_providerTxId: { provider: 'paypal', providerTxId } },
        update: {
          status: 'succeeded',
          amount,
          currency,
          customerEmail,
          customerName,
          description,
          rawPayload: JSON.stringify(event).slice(0, 10000),
        },
        create: {
          userId,
          provider: 'paypal',
          providerTxId,
          amount,
          currency,
          status: 'succeeded',
          customerEmail,
          customerName,
          description,
          rawPayload: JSON.stringify(event).slice(0, 10000),
        },
      })

      await db.incomeEntry.create({
        data: {
          amount,
          source: 'paypal',
          notes: `PayPal payment ${providerTxId}${description ? ` — ${description}` : ''}`,
          date: new Date(),
        },
      })

      console.log(`[paypal-webhook] Logged payment ${providerTxId}: $${amount} ${currency}`)
      return NextResponse.json({ received: true, transactionId: tx.id })
    }

    if (eventType === 'PAYMENT.CAPTURE.REFUNDED') {
      const providerTxId = resource?.id || event.id
      const amountRefunded = parseFloat(resource?.amount?.value || '0')
      await db.transaction.updateMany({
        where: { provider: 'paypal', providerTxId },
        data: { status: 'refunded' },
      })
      await db.incomeEntry.create({
        data: {
          amount: -amountRefunded,
          source: 'paypal-refund',
          notes: `PayPal refund for ${providerTxId}`,
          date: new Date(),
        },
      })
      return NextResponse.json({ received: true, refunded: amountRefunded })
    }

    return NextResponse.json({ received: true, unhandled: eventType })
  } catch (e: any) {
    console.error('[paypal-webhook] error:', e)
    return NextResponse.json({ error: e?.message ?? 'Webhook failed' }, { status: 500 })
  }
}
