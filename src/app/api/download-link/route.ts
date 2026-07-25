/**
 * GET /api/download-link?session_id=cs_xxx — UPGRADE #150
 * Returns the download URL for a given Stripe checkout session ID.
 *
 * Called by the /success page after payment verification. The Stripe webhook
 * may not have fired yet when /success loads (1-5s delay), so the /success
 * page polls this endpoint up to 3 times with 2s delay.
 *
 * Returns:
 *   { ok: true, url: "...", expiresAt: "..." }  — if the webhook has fired + token exists
 *   { ok: false, retry: true }                   — if the webhook hasn't fired yet
 *   { ok: false, error: "..." }                  — if the session ID is invalid
 *
 * Security: This endpoint is PUBLIC (no auth) because customers aren't logged
 * in. The session_id from Stripe is unguessable in practice (cs_test_xxx with
 * 28 chars of entropy), so it serves as the authentication token.
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 10

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const sessionId = url.searchParams.get('session_id')

  if (!sessionId) {
    return NextResponse.json({ ok: false, error: 'session_id required' }, { status: 400 })
  }

  try {
    // Look up the download token by transaction ID (stored in UserSetting)
    const user = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
    if (!user) {
      return NextResponse.json({ ok: false, retry: true })
    }

    // Find the download token with this transactionId
    const tokens = await db.userSetting.findMany({
      where: { userId: user.id, key: { startsWith: 'download_token_' } },
    })

    for (const row of tokens) {
      try {
        const data = JSON.parse(row.value)
        if (data.transactionId === sessionId && !data.revoked) {
          // Found the token — return the download URL
          const baseUrl = process.env.NEXTAUTH_URL?.replace(/\/$/, '') || 'https://agent007-ai.vercel.app'
          return NextResponse.json({
            ok: true,
            url: `${baseUrl}/api/download?token=${data.token}`,
            expiresAt: data.expiresAt,
          })
        }
      } catch {}
    }

    // Token not found — webhook probably hasn't fired yet
    return NextResponse.json({ ok: false, retry: true })
  } catch (e: any) {
    console.error('[download-link] Error:', e?.message?.slice(0, 100))
    return NextResponse.json({ ok: false, retry: true })
  }
}
