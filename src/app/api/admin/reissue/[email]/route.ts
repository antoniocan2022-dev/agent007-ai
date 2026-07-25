/**
 * POST /api/admin/reissue/[email] — UPGRADE #150 (Recommendation Gap #1)
 * Owner-only endpoint to re-send a download link to a customer by email.
 *
 * Use cases:
 *   - Customer's original email was caught in spam
 *   - Customer typo'd their email at checkout (use the corrected email here)
 *   - Customer's download link expired (7-day limit)
 *   - Customer lost the email and needs a new one
 *
 * Auth: OWNER ONLY. Checks that the logged-in user is the operator (first
 * user by createdAt). Non-operators get 401.
 *
 * Body: { reason?: string }  — optional reason for the reissue (logged to audit trail)
 *
 * Returns: { ok: true, sent: true, customerEmail, productId, productName }
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { db } from '@/lib/db'
import { findTokensByEmail, generateDownloadUrl, sendFulfillmentEmail, PRODUCTS } from '@/lib/product-fulfillment'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ email: string }> }
) {
  try {
    // Auth: owner only
    const session = await getServerSession()
    if (!session?.user) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }

    const { email: encodedEmail } = await params
    const customerEmail = decodeURIComponent(encodedEmail)
    if (!customerEmail || !customerEmail.includes('@')) {
      return NextResponse.json({ ok: false, error: 'Valid email required' }, { status: 400 })
    }

    // Verify the logged-in user is the operator (first user)
    const operator = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
    if (!operator || (session.user as any).email !== operator.email) {
      return NextResponse.json({ ok: false, error: 'Owner access required' }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const reason = typeof body.reason === 'string' ? body.reason.slice(0, 200) : 'manual reissue'

    // Find all download tokens for this customer email
    const tokens = await findTokensByEmail(customerEmail)
    if (tokens.length === 0) {
      return NextResponse.json({
        ok: false,
        error: `No purchases found for ${customerEmail}. Verify the email address is correct.`,
      }, { status: 404 })
    }

    // Reissue the most recent non-revoked token's product
    // (If the customer bought multiple products, reissue all of them)
    const results: Array<{ productId: string; productName: string; sent: boolean }> = []

    for (const tokenData of tokens) {
      if (tokenData.revoked) continue  // Skip refunded purchases

      const product = PRODUCTS[tokenData.productId]
      if (!product) continue

      // Generate a FRESH download URL (new token, new 7-day expiry)
      const { url, expiresAt } = await generateDownloadUrl({
        productId: tokenData.productId,
        customerEmail,
        transactionId: tokenData.transactionId,
      })

      // Send the fulfillment email
      try {
        await sendFulfillmentEmail({
          to: customerEmail,
          productName: product.name,
          downloadUrl: url,
          expiresAt,
        })
        results.push({ productId: tokenData.productId, productName: product.name, sent: true })
      } catch (emailErr: any) {
        console.error(`[admin/reissue] Email failed for ${customerEmail}:`, emailErr?.message?.slice(0, 100))
        results.push({ productId: tokenData.productId, productName: product.name, sent: false })
      }
    }

    // Log the reissue to the audit trail
    try {
      const { logApprovalEvent } = await import('@/lib/approval-audit-log')
      await logApprovalEvent({
        missionId: 'first_real_customer',
        stageId: `reissue_${Date.now()}`,
        round: 1,
        agentRole: 'owner',
        agentId: 'owner',
        action: 'completed',
        feedback: `Reissued download link(s) to ${customerEmail}. Reason: ${reason}. Products: ${results.map(r => r.productName).join(', ')}.`,
      })
    } catch {}

    const sentCount = results.filter(r => r.sent).length
    return NextResponse.json({
      ok: true,
      customerEmail,
      reissued: results,
      sentCount,
      totalCount: results.length,
      message: sentCount > 0
        ? `Re-sent ${sentCount} download link(s) to ${customerEmail}.`
        : `Found ${results.length} purchase(s) but email send failed. Check Resend configuration.`,
    })
  } catch (e: any) {
    console.error('[admin/reissue] Error:', e?.message?.slice(0, 200))
    return NextResponse.json(
      { ok: false, error: e?.message ?? 'Unknown error' },
      { status: 500 }
    )
  }
}
