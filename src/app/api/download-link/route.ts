/**
 * GET /api/download-link?session_id=cs_xxx
 * Returns the download URL for a Stripe checkout session after webhook fulfillment.
 *
 * This endpoint is intentionally public because the customer is not required to
 * be logged in after checkout. The Stripe checkout session ID is the external
 * lookup key; the actual download token remains separately validated by the
 * protected file-download path.
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getPublicBaseUrl } from '@/lib/runtime/public-base-url'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 10

const TOKEN_PREFIX = 'download_token_'

export async function GET(req: NextRequest) {
  const sessionId = new URL(req.url).searchParams.get('session_id')?.trim() ?? ''

  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
    return NextResponse.json({ ok: false, error: 'valid Stripe session_id required' }, { status: 400 })
  }

  try {
    // New tokens persist checkoutSessionId explicitly. The transactionId fallback
    // keeps older records compatible when payment_intent was stored instead.
    const candidates = await db.userSetting.findMany({
      where: {
        key: { startsWith: TOKEN_PREFIX },
        OR: [
          { value: { contains: `"checkoutSessionId":"${sessionId}"` } },
          { value: { contains: `"transactionId":"${sessionId}"` } },
        ],
      },
      take: 10,
    })

    for (const row of candidates) {
      try {
        const data = JSON.parse(row.value) as {
          token?: unknown
          checkoutSessionId?: unknown
          transactionId?: unknown
          expiresAt?: unknown
          revoked?: unknown
        }
        const matchesSession = data.checkoutSessionId === sessionId || data.transactionId === sessionId
        if (!matchesSession || data.revoked || typeof data.token !== 'string' || typeof data.expiresAt !== 'string') continue
        if (new Date(data.expiresAt).getTime() < Date.now()) continue

        const baseUrl = getPublicBaseUrl().replace(/\/$/, '')
        return NextResponse.json({
          ok: true,
          url: `${baseUrl}/api/file-download?token=${encodeURIComponent(data.token)}`,
          expiresAt: data.expiresAt,
        })
      } catch {
        // Ignore malformed historical records and continue searching.
      }
    }

    // Token not found — webhook may not have completed yet.
    return NextResponse.json({ ok: false, retry: true })
  } catch (error) {
    console.error('[download-link] Error:', error instanceof Error ? error.message.slice(0, 100) : String(error).slice(0, 100))
    return NextResponse.json({ ok: false, retry: true })
  }
}
