/**
 * GET /api/download?token=XXX — UPGRADE #150
 * Serves a digital product file after validating the download token.
 *
 * Flow:
 *   1. Customer pays → Stripe webhook fires → fulfillPurchase() generates a
 *      per-customer token + stores it in UserSetting
 *   2. Customer clicks the download link (in email or /success page)
 *   3. This endpoint validates the token (exists? expired? revoked?)
 *   4. If valid: serves the file from Vercel Blob (production) or /public (dev fallback)
 *   5. If invalid: returns 403 with a clear error message
 *
 * Security:
 *   - Tokens are 32 chars of randomness — unguessable in practice
 *   - Tokens expire after 7 days (configurable in product-fulfillment.ts)
 *   - Tokens are revoked on refund (via the Stripe webhook's charge.refunded handler)
 *   - One token per customer per transaction — can't be shared across customers
 */
import { NextRequest, NextResponse } from 'next/server'
import { validateDownloadToken, PRODUCTS, isBlobConfigured } from '@/lib/product-fulfillment'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const token = url.searchParams.get('token')

  if (!token) {
    return NextResponse.json(
      { ok: false, error: 'Missing download token. Check your email for the download link.' },
      { status: 400 }
    )
  }

  // Validate the token
  const tokenData = await validateDownloadToken(token)
  if (!tokenData) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Invalid or expired download token. This could mean: (1) the link has expired (7-day limit), (2) the purchase was refunded, or (3) the token was tampered with. Email antonio.can2022@hotmail.com for a new link.',
      },
      { status: 403 }
    )
  }

  const product = PRODUCTS[tokenData.productId]
  if (!product) {
    return NextResponse.json(
      { ok: false, error: `Unknown product: ${tokenData.productId}` },
      { status: 404 }
    )
  }

  // Serve the file
  // PRODUCTION: Vercel Blob — fetch the file and stream it
  // DEV FALLBACK: redirect to /products/<fileName> (INSECURE, dev only)
  if (isBlobConfigured()) {
    let blobHeadFn: ((path: string) => Promise<any>) | null = null
    try {
      // Use Function() to dynamically require @vercel/blob without TypeScript
      // trying to resolve the module at compile time. If the package isn't
      // installed, this returns null and we fall back to /public.
      const dynamicRequire = new Function('id', 'return require(id)') as (id: string) => any
      const blobModule = dynamicRequire('@vercel/blob')
      blobHeadFn = blobModule?.head ?? null
    } catch {
      // @vercel/blob not installed — fall back below
    }

    if (blobHeadFn) {
      try {
        const blobUrl = `products/${product.fileName}`
        const blobInfo = await blobHeadFn(blobUrl)
        if (!blobInfo) {
          console.error(`[download] Blob not found: ${blobUrl}`)
          return NextResponse.json(
            { ok: false, error: 'Product file not found in storage. Please contact support.' },
            { status: 404 }
          )
        }
        return NextResponse.redirect(blobInfo.url, 302)
      } catch (e: any) {
        console.error('[download] Vercel Blob error:', e?.message?.slice(0, 200))
        return NextResponse.json(
          { ok: false, error: 'Failed to retrieve file from storage. Please try again or contact support.' },
          { status: 500 }
        )
      }
    } else {
      // @vercel/blob not installed but BLOB_READ_WRITE_TOKEN is set — warn + fall back
      console.warn('[download] BLOB_READ_WRITE_TOKEN set but @vercel/blob not installed. Falling back to /public (INSECURE). Run: bun add @vercel/blob')
      return NextResponse.redirect(`/products/${product.fileName}`, 302)
    }
  } else {
    // DEV FALLBACK: redirect to /products/<fileName>
    // WARNING: This is insecure — anyone with the URL gets the file free.
    // In production, set BLOB_READ_WRITE_TOKEN and upload the file to Vercel Blob.
    console.warn('[download] DEV FALLBACK: serving from /public (INSECURE for production)')
    return NextResponse.redirect(`/products/${product.fileName}`, 302)
  }
}
