/**
 * GET /api/file-download?token=XXX
 * Serves a digital product file after validating the download token.
 *
 * Storage is deliberately provider-neutral. A hosting-specific object-storage
 * adapter is registered during runtime initialization; the application route
 * never imports a provider SDK directly.
 */
import { NextRequest, NextResponse } from 'next/server'
import { validateDownloadToken, PRODUCTS } from '@/lib/product-fulfillment'
import { getObjectStorageAdapter } from '@/lib/storage/object-storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const token = url.searchParams.get('token')

  if (!token) {
    return NextResponse.json(
      { ok: false, error: 'Missing download token. Check your email for the download link.' },
      { status: 400 },
    )
  }

  const tokenData = await validateDownloadToken(token)
  if (!tokenData) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Invalid or expired download token. The link may have expired, the purchase may have been refunded, or the token may be invalid.',
      },
      { status: 403 },
    )
  }

  const product = PRODUCTS[tokenData.productId]
  if (!product) {
    return NextResponse.json(
      { ok: false, error: `Unknown product: ${tokenData.productId}` },
      { status: 404 },
    )
  }

  const storage = getObjectStorageAdapter()
  if (!storage?.isConfigured()) {
    // Never expose an insecure public-file fallback in production. A future
    // host registers its own adapter without changing this route.
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        { ok: false, error: 'Product storage is not configured. Please contact support.' },
        { status: 503 },
      )
    }
    return NextResponse.redirect(`/products/${encodeURIComponent(product.fileName)}`, 302)
  }

  const pathname = `products/${product.fileName}`
  try {
    const blob = await storage.head(pathname)
    if (!blob?.url) {
      return NextResponse.json(
        { ok: false, error: 'Product file not found in storage. Please contact support.' },
        { status: 404 },
      )
    }
    return NextResponse.redirect(blob.url, 302)
  } catch (error) {
    console.error('[download] storage adapter error:', error instanceof Error ? error.message : String(error))
    return NextResponse.json(
      { ok: false, error: 'Failed to retrieve file from storage. Please try again or contact support.' },
      { status: 502 },
    )
  }
}
