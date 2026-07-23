import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUserId } from '@/lib/session-user'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/webhooks/paypal — UPGRADE #121 (CRITICAL SECURITY FIX)
 *
 * Receives PayPal webhook events. Verifies the webhook signature via
 * PayPal's verify-webhook-signature API. FAILS CLOSED if PayPal
 * credentials are not set or the signature is invalid.
 *
 * SECURITY: This endpoint NO LONGER accepts unsigned payloads.
 * Anyone who finds this URL cannot forge fake payment events.
 *
 * Setup:
 *   1. Set PAYPAL_CLIENT_ID + PAYPAL_CLIENT_SECRET + PAYPAL_WEBHOOK_ID env vars
 *   2. Configure a webhook in PayPal Developer Dashboard → My Apps → your app
 *   3. Subscribe to: PAYMENT.CAPTURE.COMPLETED, PAYMENT.CAPTURE.REFUNDED
 */
export async function POST(req: NextRequest) {
  const paypalClientId = process.env.PAYPAL_CLIENT_ID
  const paypalClientSecret = process.env.PAYPAL_CLIENT_SECRET
  const paypalWebhookId = process.env.PAYPAL_WEBHOOK_ID

  // ── UPGRADE #121: FAIL-CLOSED if PayPal credentials are not set ──
  if (!paypalClientId || !paypalClientSecret || !paypalWebhookId) {
    console.error('[paypal-webhook] REJECTED: PayPal credentials not set (need PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID).')
    return NextResponse.json(
      { error: 'PayPal credentials not configured. Set PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID env vars.' },
      { status: 503 }
    )
  }

  const rawBody = await req.text()
  let event: any
  try {
    event = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // ── UPGRADE #121: Verify the webhook signature via PayPal API ──
  // PayPal sends these headers with every webhook:
  const transmissionId = req.headers.get('paypal-transmission-id') || ''
  const transmissionTime = req.headers.get('paypal-transmission-time') || ''
  const certUrl = req.headers.get('paypal-cert-url') || ''
  const authAlgo = req.headers.get('paypal-auth-algo') || ''
  const transmissionSig = req.headers.get('paypal-transmission-sig') || ''

  if (!transmissionSig || !transmissionId) {
    console.error('[paypal-webhook] REJECTED: Missing PayPal signature headers.')
    return NextResponse.json({ error: 'Missing PayPal signature headers' }, { status: 400 })
  }

  // Call PayPal's verify-webhook-signature API
  try {
    // Step 1: Get an access token from PayPal
    const tokenResp = await fetch('https://api-m.paypal.com/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Accept-Language': 'en_US',
        'Authorization': 'Basic ' + Buffer.from(`${paypalClientId}:${paypalClientSecret}`).toString('base64'),
      },
      body: 'grant_type=client_credentials',
    })
    if (!tokenResp.ok) {
      console.error('[paypal-webhook] PayPal token fetch failed:', tokenResp.status)
      return NextResponse.json({ error: 'PayPal auth failed' }, { status: 502 })
    }
    const tokenData = await tokenResp.json()
    const accessToken = tokenData.access_token

    // Step 2: Verify the webhook signature
    const verifyResp = await fetch('https://api-m.paypal.com/v1/notifications/verify-webhook-signature', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        auth_algo: authAlgo,
        cert_url: certUrl,
        transmission_id: transmissionId,
        transmission_sig: transmissionSig,
        transmission_time: transmissionTime,
        webhook_id: paypalWebhookId,
        webhook_event: event,
      }),
    })
    if (!verifyResp.ok) {
      console.error('[paypal-webhook] PayPal verify API failed:', verifyResp.status)
      return NextResponse.json({ error: 'PayPal verification API failed' }, { status: 502 })
    }
    const verifyData = await verifyResp.json()
    if (verifyData.verification_status !== 'SUCCESS') {
      console.error('[paypal-webhook] SIGNATURE VERIFICATION FAILED:', verifyData.verification_status)
      return NextResponse.json(
        { error: `PayPal signature verification failed: ${verifyData.verification_status}` },
        { status: 400 }
      )
    }
    // Signature verified — proceed to process the event
  } catch (e: any) {
    console.error('[paypal-webhook] Verification error:', e?.message?.slice(0, 200))
    return NextResponse.json({ error: `Verification error: ${e?.message?.slice(0, 100)}` }, { status: 500 })
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
