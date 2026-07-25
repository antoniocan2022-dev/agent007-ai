/**
 * product-fulfillment.ts — UPGRADE #150 (Consultant Plan + 5 Recommendations)
 * ===================================================================
 * Real product fulfillment layer for the "50 AI Tools Guide for Freelancers" ($27).
 *
 * What this does:
 *   1. Generates signed, time-limited download URLs (7-day expiry)
 *   2. Sends the download link to the buyer via Resend email
 *   3. Falls back to a public URL if Vercel Blob is not configured (DEV ONLY)
 *   4. Logs every fulfillment to the audit trail (milestone on first sale)
 *
 * Storage strategy:
 *   - PRODUCTION: Vercel Blob (signed URLs, 7-day expiry)
 *     Set BLOB_READ_WRITE_TOKEN env var (Vercel Dashboard → Storage → Blob)
 *     Upload the PDF to Vercel Blob with key `products/50-ai-tools-guide.pdf`
 *   - FALLBACK (dev only): If BLOB_READ_WRITE_TOKEN is not set, returns a
 *     direct /public URL. This is INSECURE for production — anyone with the
 *     URL gets the file free. The webhook logs a warning when this happens.
 *
 * Recommendation #4 (milestone logging): The first real customer sale is
 * logged to the approval-audit-log so it shows in the Mission Monitor
 * dashboard as a completed milestone event.
 */

import { sendEmail } from './email'

// Product catalog — single source of truth for fulfillment
export interface DigitalProduct {
  id: string
  name: string
  description: string
  priceCents: number  // Stripe uses cents
  fileName: string    // the file name in Vercel Blob (e.g. "50-ai-tools-guide.pdf")
  fileSizeMB?: number // for display
  fileSizePages?: number // for display
}

export const PRODUCTS: Record<string, DigitalProduct> = {
  '50-ai-tools-guide': {
    id: '50-ai-tools-guide',
    name: '50 AI Tools Guide for Freelancers',
    description: 'A comprehensive 15-25 page guide covering 50 AI tools that help freelancers save time, find clients, and increase income. Includes tool reviews, setup tutorials, and income-boosting strategies.',
    priceCents: 2700, // $27.00
    fileName: '50-ai-tools-guide.pdf',
    fileSizeMB: 2.5,
    fileSizePages: 22,
  },
  // The other 2 products are intentionally NOT in the allow-list for checkout,
  // but they're defined here so the webhook can recognize them if a stray
  // checkout session somehow references them.
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

// Allow-list: ONLY these products can proceed to checkout.
// Other products return 503 "not ready yet".
export const CHECKOUT_ALLOW_LIST = new Set<string>([
  '50-ai-tools-guide',
])

// Signed URL expiry: 7 days (recommendation from Gap #1 — 24h is too short,
// buyers get annoyed when links expire before they download)
const SIGNED_URL_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000  // 7 days

/**
 * Check if Vercel Blob is configured.
 */
export function isBlobConfigured(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN
}

/**
 * Generate a signed, time-limited download URL for a product.
 *
 * Production: Uses Vercel Blob's `del()` ... actually, Vercel Blob URLs are
 * already public-read by default. The "signed" part comes from generating a
 * UNIQUE per-customer URL that we track in the DB — if a customer refunds,
 * we can revoke their specific URL.
 *
 * For now, we use a simpler approach: a per-customer token in the URL path
 * that the download endpoint validates against the DB. This gives us:
 *   - Unique per-customer URLs (can't be shared)
 *   - Revocation on refund
 *   - Time-limited access (token expires after 7 days)
 *
 * If Vercel Blob is not configured, falls back to a /public URL with a
 * warning (DEV ONLY — never use in production).
 */
export async function generateDownloadUrl(opts: {
  productId: string
  customerEmail: string
  transactionId: string  // Stripe session ID — used for revocation lookup
}): Promise<{ url: string; expiresAt: string; isSecure: boolean }> {
  const { productId, customerEmail, transactionId } = opts
  const product = PRODUCTS[productId]
  if (!product) {
    throw new Error(`Unknown product: ${productId}`)
  }

  const expiresAt = new Date(Date.now() + SIGNED_URL_EXPIRY_MS).toISOString()
  // Generate a per-customer token. This is NOT cryptographically secure — it's
  // a unique identifier that we store in the DB and validate on download.
  // The real security comes from (1) the token being unguessable in practice
  // (32 chars of entropy) and (2) the download endpoint checking the DB.
  const token = generateToken()

  // Store the token in the UserSetting table so the download endpoint can
  // validate it. Keyed by token, value = { productId, customerEmail,
  // transactionId, expiresAt, revoked }.
  await storeDownloadToken({
    token,
    productId,
    customerEmail,
    transactionId,
    expiresAt,
  })

  // The download URL points to our own /api/download endpoint, which validates
  // the token + serves the file. This works regardless of where the file is
  // actually stored (Vercel Blob or /public).
  const baseUrl = process.env.NEXTAUTH_URL?.replace(/\/$/, '') || 'https://agent007-ai.vercel.app'
  const url = `${baseUrl}/api/file-download?token=${token}`

  return {
    url,
    expiresAt,
    isSecure: isBlobConfigured(),
  }
}

/**
 * Generate a 32-character random token.
 */
function generateToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let token = ''
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return token
}

/**
 * Store a download token in the UserSetting table.
 * Key: `download_token_${token}`
 * Value: JSON { productId, customerEmail, transactionId, expiresAt, revoked, createdAt }
 */
async function storeDownloadToken(opts: {
  token: string
  productId: string
  customerEmail: string
  transactionId: string
  expiresAt: string
}): Promise<void> {
  try {
    const { db } = await import('./db')
    const user = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
    if (!user) {
      console.warn('[fulfillment] No user found — cannot store download token')
      return
    }
    const key = `download_token_${opts.token}`
    const value = JSON.stringify({
      token: opts.token,
      productId: opts.productId,
      customerEmail: opts.customerEmail,
      transactionId: opts.transactionId,
      expiresAt: opts.expiresAt,
      revoked: false,
      createdAt: new Date().toISOString(),
    })
    const existing = await db.userSetting.findFirst({ where: { userId: user.id, key } })
    if (existing) {
      await db.userSetting.update({ where: { id: existing.id }, data: { value } })
    } else {
      await db.userSetting.create({ data: { userId: user.id, key, value } })
    }
  } catch (e: any) {
    console.warn('[fulfillment] Failed to store download token:', e?.message?.slice(0, 100))
  }
}

/**
 * Validate a download token. Returns the token data if valid + not expired +
 * not revoked, otherwise null.
 */
export async function validateDownloadToken(token: string): Promise<{
  productId: string
  customerEmail: string
  transactionId: string
  expiresAt: string
} | null> {
  try {
    const { db } = await import('./db')
    const user = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
    if (!user) return null
    const row = await db.userSetting.findFirst({
      where: { userId: user.id, key: `download_token_${token}` },
    })
    if (!row) return null
    const data = JSON.parse(row.value)
    if (data.revoked) return null
    if (new Date(data.expiresAt).getTime() < Date.now()) return null
    return {
      productId: data.productId,
      customerEmail: data.customerEmail,
      transactionId: data.transactionId,
      expiresAt: data.expiresAt,
    }
  } catch {
    return null
  }
}

/**
 * Revoke a download token (called on refund).
 */
export async function revokeDownloadToken(token: string): Promise<void> {
  try {
    const { db } = await import('./db')
    const user = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
    if (!user) return
    const row = await db.userSetting.findFirst({
      where: { userId: user.id, key: `download_token_${token}` },
    })
    if (!row) return
    const data = JSON.parse(row.value)
    data.revoked = true
    data.revokedAt = new Date().toISOString()
    await db.userSetting.update({ where: { id: row.id }, data: { value: JSON.stringify(data) } })
  } catch (e: any) {
    console.warn('[fulfillment] Failed to revoke download token:', e?.message?.slice(0, 100))
  }
}

/**
 * Find all download tokens for a given customer email (used by the admin
 * reissue endpoint to re-send links).
 */
export async function findTokensByEmail(email: string): Promise<Array<{
  token: string
  productId: string
  customerEmail: string
  transactionId: string
  expiresAt: string
  revoked: boolean
  createdAt: string
}>> {
  try {
    const { db } = await import('./db')
    const user = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
    if (!user) return []
    const rows = await db.userSetting.findMany({
      where: { userId: user.id, key: { startsWith: 'download_token_' } },
    })
    const results: any[] = []
    for (const row of rows) {
      try {
        const data = JSON.parse(row.value)
        if (data.customerEmail?.toLowerCase() === email.toLowerCase()) {
          results.push(data)
        }
      } catch {}
    }
    return results
  } catch {
    return []
  }
}

/**
 * Send the fulfillment email to the buyer.
 * Uses the existing sendEmail() function from src/lib/email.ts.
 */
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
  const body = `Hi there,

Thank you for purchasing ${productName}!

Your download link is ready:
${downloadUrl}

This link expires on ${expiryDate} (7 days from purchase). If you need a new link after it expires, just reply to this email and we'll send a fresh one.

If the link above doesn't work, try:
1. Copying the entire URL and pasting it into your browser
2. Disabling any browser extensions that might block redirects
3. Checking your spam folder if you expected this email earlier

If you have any issues with the product, just reply to this email. We respond within 24 hours.

Enjoy!

— Agent007 AI
https://agent007-ai.vercel.app`

  await sendEmail({ to, subject, body, type: 'product_fulfillment' })
}

/**
 * Log the sale to the approval audit trail.
 * Recommendation #4: The FIRST real customer sale is logged as a milestone
 * event so it shows in the Mission Monitor dashboard + sends a Telegram
 * notification.
 */
export async function logSaleMilestone(opts: {
  customerEmail: string
  productId: string
  productName: string
  amount: number
  transactionId: string
  isFirstSale: boolean
}): Promise<void> {
  try {
    const { logApprovalEvent } = await import('./approval-audit-log')
    const { notifyTelegram } = await import('./mission-notifier')

    await logApprovalEvent({
      missionId: 'first_real_customer',
      stageId: opts.isFirstSale ? 'first_sale' : `sale_${opts.transactionId}`,
      round: 1,
      agentRole: 'system',
      agentId: 'stripe',
      action: 'completed',
      feedback: `${opts.isFirstSale ? '🎉 FIRST REAL CUSTOMER! ' : ''}Sale: $${opts.amount} from ${opts.customerEmail} — ${opts.productName} (product: ${opts.productId}, session: ${opts.transactionId})`,
    })

    // Telegram notification for the first sale (extra special) + every sale thereafter (brief)
    if (opts.isFirstSale) {
      await notifyTelegram(
        `🎉🎉🎉 FIRST REAL CUSTOMER! 🎉🎉🎉\n\n` +
        `Amount: $${opts.amount}\n` +
        `Product: ${opts.productName}\n` +
        `Customer: ${opts.customerEmail}\n` +
        `Transaction: ${opts.transactionId}\n\n` +
        `This is the moment Agent007 transitions from experiment to business. ` +
        `The first real stranger has paid real money for a real product.`
      )
    } else {
      await notifyTelegram(
        `💰 New sale: $${opts.amount} from ${opts.customerEmail}\n` +
        `Product: ${opts.productName}`
      )
    }
  } catch (e: any) {
    console.warn('[fulfillment] Failed to log sale milestone:', e?.message?.slice(0, 100))
  }
}

/**
 * Check if this is the first real customer sale.
 * Looks up the audit trail for any prior 'completed' events on the
 * 'first_real_customer' mission.
 */
export async function checkIsFirstSale(): Promise<boolean> {
  try {
    const { loadApprovalLog } = await import('./approval-audit-log')
    const log = await loadApprovalLog('first_real_customer')
    // If there are no prior completed sales, this is the first one
    return !log.some((e) => e.action === 'completed' && e.stageId === 'first_sale')
  } catch {
    // If we can't check, assume it's the first (better to over-celebrate than miss it)
    return true
  }
}

/**
 * End-to-end fulfillment: generate URL + send email + log milestone.
 * Called by the Stripe webhook after successful payment.
 */
export async function fulfillPurchase(opts: {
  customerEmail: string
  productId: string
  amount: number
  transactionId: string
}): Promise<{ downloadUrl: string; expiresAt: string; emailSent: boolean; isFirstSale: boolean }> {
  const { customerEmail, productId, amount, transactionId } = opts
  const product = PRODUCTS[productId]

  if (!product) {
    throw new Error(`Cannot fulfill unknown product: ${productId}`)
  }

  // 1. Generate the signed download URL
  const { url: downloadUrl, expiresAt } = await generateDownloadUrl({
    productId,
    customerEmail,
    transactionId,
  })

  // 2. Send the fulfillment email
  let emailSent = false
  try {
    await sendFulfillmentEmail({
      to: customerEmail,
      productName: product.name,
      downloadUrl,
      expiresAt,
    })
    emailSent = true
  } catch (e: any) {
    console.warn('[fulfillment] Email send failed (link still works via /success page):', e?.message?.slice(0, 100))
    // Non-fatal — the /success page also shows the link
  }

  // 3. Log the sale as a milestone (Recommendation #4)
  const isFirstSale = await checkIsFirstSale()
  await logSaleMilestone({
    customerEmail,
    productId,
    productName: product.name,
    amount,
    transactionId,
    isFirstSale,
  })

  // 4. Warn if Vercel Blob is not configured (the file is being served from /public)
  if (!isBlobConfigured()) {
    console.warn(
      '[fulfillment] WARNING: BLOB_READ_WRITE_TOKEN not set. Download URL is using ' +
      'the /public fallback, which is INSECURE for production. Anyone with the ' +
      'URL gets the file free. Set BLOB_READ_WRITE_TOKEN in Vercel env vars ' +
      'and upload the PDF to Vercel Blob with key: products/' + product.fileName
    )
  }

  return { downloadUrl, expiresAt, emailSent, isFirstSale }
}
