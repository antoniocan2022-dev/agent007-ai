/**
 * Product fulfillment and download-token lifecycle.
 *
 * Business logic is hosting-neutral. Object storage and public URL resolution
 * are supplied by explicit runtime adapters.
 */
import { randomBytes } from 'node:crypto'
import { db } from './db'
import { sendEmail } from './email'
import { loadApprovalLog, logApprovalEvent } from './approval-audit-log'
import { notifyTelegram } from './mission-notifier'
import { getPublicBaseUrl } from './runtime/public-base-url'
import { getObjectStorageAdapter } from './storage/object-storage'

export interface DigitalProduct {
  id: string
  name: string
  description: string
  priceCents: number
  fileName: string
  fileSizeMB?: number
  fileSizePages?: number
}

export const PRODUCTS: Record<string, DigitalProduct> = {
  '50-ai-tools-guide': {
    id: '50-ai-tools-guide',
    name: '50 AI Tools Guide for Freelancers',
    description: 'A comprehensive 15-25 page guide covering 50 AI tools that help freelancers save time, find clients, and increase income. Includes tool reviews, setup tutorials, and income-boosting strategies.',
    priceCents: 2700,
    fileName: '50-ai-tools-guide.pdf',
    fileSizeMB: 2.5,
    fileSizePages: 22,
  },
  'affiliate-blog-network-kit': {
    id: 'affiliate-blog-network-kit',
    name: 'Affiliate Blog Network Starter Kit',
    description: 'Complete kit to launch a 12-article affiliate blog network.',
    priceCents: 4700,
    fileName: 'affiliate-blog-network-kit.pdf',
  },
  'saas-micro-tool-blueprint': {
    id: 'saas-micro-tool-blueprint',
    name: 'SaaS Micro-Tool Blueprint',
    description: 'Step-by-step blueprint for building and launching a $9/mo SaaS micro-tool.',
    priceCents: 6700,
    fileName: 'saas-micro-tool-blueprint.pdf',
  },
}

export const CHECKOUT_ALLOW_LIST = new Set<string>(['50-ai-tools-guide'])
const SIGNED_URL_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000
const TOKEN_PREFIX = 'download_token_'

type DownloadTokenRecord = {
  token: string
  productId: string
  customerEmail: string
  transactionId: string
  checkoutSessionId: string
  expiresAt: string
  revoked: boolean
  createdAt: string
}

export function isBlobConfigured(): boolean {
  return Boolean(getObjectStorageAdapter()?.isConfigured())
}

export function generateDownloadToken(): string {
  return randomBytes(32).toString('base64url')
}

export async function generateDownloadUrl(opts: {
  ownerUserId: string
  productId: string
  customerEmail: string
  transactionId: string
  checkoutSessionId?: string
}): Promise<{ url: string; expiresAt: string; isSecure: boolean }> {
  const { ownerUserId, productId, customerEmail, transactionId } = opts
  const checkoutSessionId = opts.checkoutSessionId ?? transactionId
  const product = PRODUCTS[productId]
  if (!product) throw new Error(`Unknown product: ${productId}`)

  const storageConfigured = isBlobConfigured()
  if (process.env.NODE_ENV === 'production' && !storageConfigured) {
    throw new Error('Product storage is not configured for production fulfillment')
  }

  const expiresAt = new Date(Date.now() + SIGNED_URL_EXPIRY_MS).toISOString()
  const token = generateDownloadToken()
  const key = `${TOKEN_PREFIX}${token}`
  const record: DownloadTokenRecord = {
    token,
    productId,
    customerEmail,
    transactionId,
    checkoutSessionId,
    expiresAt,
    revoked: false,
    createdAt: new Date().toISOString(),
  }

  await db.userSetting.upsert({
    where: { userId_key: { userId: ownerUserId, key } },
    create: { userId: ownerUserId, key, value: JSON.stringify(record) },
    update: { value: JSON.stringify(record) },
  })

  const baseUrl = getPublicBaseUrl().replace(/\/$/, '')
  return {
    url: `${baseUrl}/api/file-download?token=${encodeURIComponent(token)}`,
    expiresAt,
    isSecure: storageConfigured,
  }
}

function parseTokenRecord(value: string): DownloadTokenRecord | null {
  try {
    const parsed = JSON.parse(value) as Partial<DownloadTokenRecord>
    if (
      typeof parsed.token !== 'string' ||
      typeof parsed.productId !== 'string' ||
      typeof parsed.customerEmail !== 'string' ||
      typeof parsed.transactionId !== 'string' ||
      typeof parsed.expiresAt !== 'string' ||
      typeof parsed.createdAt !== 'string'
    ) return null

    return {
      token: parsed.token,
      productId: parsed.productId,
      customerEmail: parsed.customerEmail,
      transactionId: parsed.transactionId,
      checkoutSessionId: typeof parsed.checkoutSessionId === 'string' ? parsed.checkoutSessionId : parsed.transactionId,
      expiresAt: parsed.expiresAt,
      revoked: parsed.revoked === true,
      createdAt: parsed.createdAt,
    }
  } catch {
    return null
  }
}

export async function validateDownloadToken(token: string): Promise<{
  productId: string
  customerEmail: string
  transactionId: string
  checkoutSessionId: string
  expiresAt: string
} | null> {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) return null
  try {
    const row = await db.userSetting.findFirst({ where: { key: `${TOKEN_PREFIX}${token}` } })
    if (!row) return null
    const data = parseTokenRecord(row.value)
    if (!data || data.revoked || new Date(data.expiresAt).getTime() < Date.now()) return null
    return {
      productId: data.productId,
      customerEmail: data.customerEmail,
      transactionId: data.transactionId,
      checkoutSessionId: data.checkoutSessionId,
      expiresAt: data.expiresAt,
    }
  } catch {
    return null
  }
}

export async function revokeDownloadToken(token: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) return
  try {
    const row = await db.userSetting.findFirst({ where: { key: `${TOKEN_PREFIX}${token}` } })
    if (!row) return
    const data = parseTokenRecord(row.value)
    if (!data) return
    await db.userSetting.update({
      where: { id: row.id },
      data: { value: JSON.stringify({ ...data, revoked: true, revokedAt: new Date().toISOString() }) },
    })
  } catch (error) {
    console.warn('[fulfillment] Failed to revoke download token:', error instanceof Error ? error.message.slice(0, 100) : String(error).slice(0, 100))
  }
}

export async function findTokensByEmail(email: string, ownerUserId: string): Promise<Array<DownloadTokenRecord>> {
  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail || !ownerUserId) return []
  try {
    const rows = await db.userSetting.findMany({
      where: { userId: ownerUserId, key: { startsWith: TOKEN_PREFIX } },
    })
    const results: DownloadTokenRecord[] = []
    for (const row of rows) {
      const data = parseTokenRecord(row.value)
      if (data?.customerEmail.toLowerCase() === normalizedEmail) results.push(data)
    }
    return results
  } catch {
    return []
  }
}

export async function sendFulfillmentEmail(opts: {
  to: string
  productName: string
  downloadUrl: string
  expiresAt: string
}): Promise<void> {
  const { to, productName, downloadUrl, expiresAt } = opts
  const expiryDate = new Date(expiresAt).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  const subject = `Your ${productName} — Download Inside`
  const body = `Hi there,\n\nThank you for purchasing ${productName}!\n\nYour download link is ready:\n${downloadUrl}\n\nThis link expires on ${expiryDate} (7 days from purchase). If you need a new link after it expires, just reply to this email and we'll send a fresh one.\n\nIf you have any issues with the product, just reply to this email. We respond within 24 hours.\n\nEnjoy!\n\n— Agent007 AI\n${getPublicBaseUrl()}`
  await sendEmail({ to, subject, body, type: 'product_fulfillment' })
}

export async function logSaleMilestone(opts: {
  customerEmail: string
  productId: string
  productName: string
  amount: number
  transactionId: string
  isFirstSale: boolean
}): Promise<void> {
  try {
    await logApprovalEvent({
      missionId: 'first_real_customer',
      stageId: opts.isFirstSale ? 'first_sale' : `sale_${opts.transactionId}`,
      round: 1,
      agentRole: 'system',
      agentId: 'stripe',
      action: 'completed',
      feedback: `${opts.isFirstSale ? '🎉 FIRST REAL CUSTOMER! ' : ''}Sale: $${opts.amount} from ${opts.customerEmail} — ${opts.productName} (product: ${opts.productId}, transaction: ${opts.transactionId})`,
    })

    await notifyTelegram(
      opts.isFirstSale
        ? `🎉 FIRST REAL CUSTOMER!\n\nAmount: $${opts.amount}\nProduct: ${opts.productName}\nCustomer: ${opts.customerEmail}\nTransaction: ${opts.transactionId}`
        : `💰 New sale: $${opts.amount} from ${opts.customerEmail}\nProduct: ${opts.productName}`,
    )
  } catch (error) {
    console.warn('[fulfillment] Failed to log sale milestone:', error instanceof Error ? error.message.slice(0, 100) : String(error).slice(0, 100))
  }
}

export async function checkIsFirstSale(): Promise<boolean> {
  try {
    const log = await loadApprovalLog('first_real_customer')
    return !log.some((event) => event.action === 'completed' && event.stageId === 'first_sale')
  } catch (error) {
    console.warn('[fulfillment] Unable to verify first-sale state; failing closed:', error instanceof Error ? error.message.slice(0, 100) : String(error).slice(0, 100))
    return false
  }
}

export async function fulfillPurchase(opts: {
  ownerUserId: string
  customerEmail: string
  productId: string
  amount: number
  transactionId: string
  checkoutSessionId?: string
}): Promise<{ downloadUrl: string; expiresAt: string; emailSent: boolean; isFirstSale: boolean }> {
  const { ownerUserId, customerEmail, productId, amount, transactionId } = opts
  const checkoutSessionId = opts.checkoutSessionId ?? transactionId
  const product = PRODUCTS[productId]
  if (!product) throw new Error(`Cannot fulfill unknown product: ${productId}`)

  const { url: downloadUrl, expiresAt } = await generateDownloadUrl({
    ownerUserId,
    productId,
    customerEmail,
    transactionId,
    checkoutSessionId,
  })

  let emailSent = false
  try {
    await sendFulfillmentEmail({ to: customerEmail, productName: product.name, downloadUrl, expiresAt })
    emailSent = true
  } catch (error) {
    console.warn('[fulfillment] Email send failed (download link remains valid):', error instanceof Error ? error.message.slice(0, 100) : String(error).slice(0, 100))
  }

  const isFirstSale = await checkIsFirstSale()
  await logSaleMilestone({ customerEmail, productId, productName: product.name, amount, transactionId, isFirstSale })

  return { downloadUrl, expiresAt, emailSent, isFirstSale }
}
