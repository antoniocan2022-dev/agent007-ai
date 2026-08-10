import type { RevenueExecutionAction } from '@/lib/revenue-execution'
import nodemailer from 'nodemailer'
import Stripe from 'stripe'
import { PRODUCTS, CHECKOUT_ALLOW_LIST } from '@/lib/product-fulfillment'

export type RevenueExecutorContext = {
  actionId: string
  action: RevenueExecutionAction
  attrs: Record<string, unknown>
}

export type RevenueExecutorResult = {
  externalSideEffect: boolean
  revenueVerified: boolean
  reference?: string
  details?: Record<string, unknown>
}

export type RevenueExecutor = {
  id: string
  action: RevenueExecutionAction
  capability: 'outreach' | 'checkout' | 'fulfillment' | 'offer'
  enabled: boolean
  execute: (context: RevenueExecutorContext) => Promise<RevenueExecutorResult>
}

function envEnabled(name: string) {
  return process.env[name]?.trim().toLowerCase() === 'true'
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required for the revenue executor.`)
  return value
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function getPayload(attrs: Record<string, unknown>) {
  const payload = attrs.payload
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {}
}

function createSmtpTransport() {
  const host = requiredEnv('REVENUE_OUTREACH_SMTP_HOST')
  const rawPort = process.env.REVENUE_OUTREACH_SMTP_PORT?.trim() || '587'
  const port = Number(rawPort)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('REVENUE_OUTREACH_SMTP_PORT must be a valid TCP port.')
  const secure = envEnabled('REVENUE_OUTREACH_SMTP_SECURE')
  const user = requiredEnv('REVENUE_OUTREACH_SMTP_USER')
  const pass = requiredEnv('REVENUE_OUTREACH_SMTP_PASS')

  return nodemailer.createTransport({ host, port, secure, auth: { user, pass } })
}

function createStripeClient() {
  return new Stripe(requiredEnv('STRIPE_SECRET_KEY'), { apiVersion: '2024-12-18.acacia' as any })
}

const unavailable = (id: string, action: RevenueExecutionAction, capability: RevenueExecutor['capability']): RevenueExecutor => ({
  id,
  action,
  capability,
  enabled: false,
  async execute() {
    throw new Error(`No authorized ${capability} executor is configured for ${action}.`)
  },
})

const smtpOutreach: RevenueExecutor = {
  id: 'outreach-smtp-v1',
  action: 'prepare_outreach',
  capability: 'outreach',
  enabled: envEnabled('REVENUE_OUTREACH_EXECUTOR_ENABLED'),
  async execute({ actionId, attrs }) {
    if (!envEnabled('REVENUE_OUTREACH_EXECUTOR_ENABLED')) throw new Error('The SMTP outreach executor is disabled.')

    const payload = getPayload(attrs)
    const to = stringValue(payload.to) || stringValue(attrs.to)
    const subject = stringValue(payload.subject) || stringValue(attrs.subject)
    const text = stringValue(payload.text) || stringValue(attrs.text)
    const html = stringValue(payload.html) || stringValue(attrs.html)
    const from = stringValue(payload.from) || stringValue(attrs.from) || requiredEnv('REVENUE_OUTREACH_FROM')
    const idempotencyKey = stringValue(attrs.idempotencyKey)

    if (!to) throw new Error('Outreach payload requires payload.to.')
    if (!subject) throw new Error('Outreach payload requires payload.subject.')
    if (!text && !html) throw new Error('Outreach payload requires payload.text or payload.html.')
    if (!idempotencyKey) throw new Error('Outreach execution requires the persisted idempotency key.')

    const transport = createSmtpTransport()
    const safeKey = idempotencyKey.replace(/[^a-zA-Z0-9._-]/g, '-')
    const messageId = `<agent007-${safeKey}-${actionId}@agent007.local>`
    const info = await transport.sendMail({
      from,
      to,
      subject,
      text: text || undefined,
      html: html || undefined,
      messageId,
      headers: {
        'X-Agent007-Action-Id': actionId,
        'X-Agent007-Idempotency-Key': idempotencyKey,
      },
    })

    return {
      externalSideEffect: true,
      revenueVerified: false,
      reference: info.messageId || messageId,
      details: {
        provider: 'smtp',
        accepted: info.accepted,
        rejected: info.rejected,
        response: info.response,
        messageId: info.messageId || messageId,
      },
    }
  },
}

const stripeCheckout: RevenueExecutor = {
  id: 'checkout-stripe-v1',
  action: 'prepare_checkout',
  capability: 'checkout',
  enabled: envEnabled('REVENUE_CHECKOUT_EXECUTOR_ENABLED'),
  async execute({ actionId, attrs }) {
    if (!envEnabled('REVENUE_CHECKOUT_EXECUTOR_ENABLED')) throw new Error('The Stripe checkout executor is disabled.')

    const userId = stringValue(attrs.userId)
    if (!userId) throw new Error('Checkout execution requires an authenticated operator identity.')

    const payload = getPayload(attrs)
    const productId = stringValue(payload.productId) || '50-ai-tools-guide'
    if (!CHECKOUT_ALLOW_LIST.has(productId)) throw new Error(`Product ${productId} is not approved for checkout.`)

    const product = PRODUCTS[productId]
    if (!product) throw new Error(`Approved checkout product ${productId} is unavailable.`)

    const customerEmail = stringValue(payload.customerEmail) || undefined
    const stripe = createStripeClient()
    const origin = stringValue(payload.origin) || 'https://agent007-ai.vercel.app'
    const idempotencyKey = stringValue(attrs.idempotencyKey)
    if (!idempotencyKey) throw new Error('Checkout execution requires the persisted idempotency key.')

    let discounts: Stripe.Checkout.SessionCreateParams.Discount[] | undefined
    try {
      const coupon = await stripe.coupons.retrieve('LAUNCH50')
      if (!coupon.deleted && coupon.valid) discounts = [{ coupon: 'LAUNCH50' }]
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
      success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}&product=${encodeURIComponent(productId)}`,
      cancel_url: `${origin}/buy/${encodeURIComponent(productId)}?canceled=true`,
      metadata: {
        productId,
        productName: product.name,
        source: 'agent007-ai',
        agent007UserId: userId,
        revenueActionId: actionId,
        revenueIdempotencyKey: idempotencyKey,
      },
      ...(discounts ? { discounts } : {}),
      customer_email: customerEmail,
      billing_address_collection: 'auto',
    }, { idempotencyKey: `agent007-checkout-${idempotencyKey}` })

    return {
      externalSideEffect: true,
      revenueVerified: false,
      reference: session.id,
      details: {
        provider: 'stripe',
        checkoutSessionId: session.id,
        checkoutUrl: session.url,
        productId,
        paymentStatus: session.payment_status,
        revenueActionId: actionId,
      },
    }
  },
}

/**
 * Closed-world executor registry. External side effects require an exact
 * capability-specific executor and explicit deployment configuration.
 */
export const REVENUE_EXECUTORS: RevenueExecutor[] = [
  unavailable('offer-preparation-v1', 'prepare_offer', 'offer'),
  smtpOutreach,
  stripeCheckout,
  unavailable('fulfillment-v1', 'prepare_fulfillment', 'fulfillment'),
]

export function getRevenueExecutor(action: RevenueExecutionAction) {
  return REVENUE_EXECUTORS.find((executor) => executor.action === action) ?? null
}

export function getRevenueExecutorCatalog() {
  return REVENUE_EXECUTORS.map(({ execute: _execute, ...executor }) => executor)
}
