/**
 * POST /api/admin/reissue/[email]
 * Owner-only endpoint to re-send a download link to a customer.
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
  { params }: { params: Promise<{ email: string }> },
) {
  try {
    const session = await getServerSession()
    if (!session?.user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const { email: encodedEmail } = await params
    const customerEmail = decodeURIComponent(encodedEmail).trim()
    if (!customerEmail || !customerEmail.includes('@')) {
      return NextResponse.json({ ok: false, error: 'Valid email required' }, { status: 400 })
    }

    const operator = await db.user.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true, email: true } })
    if (!operator || session.user.email !== operator.email) {
      return NextResponse.json({ ok: false, error: 'Owner access required' }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const reason = typeof body.reason === 'string' ? body.reason.slice(0, 200) : 'manual reissue'
    const tokens = await findTokensByEmail(customerEmail, operator.id)

    if (tokens.length === 0) {
      return NextResponse.json({ ok: false, error: `No purchases found for ${customerEmail}. Verify the email address is correct.` }, { status: 404 })
    }

    const results: Array<{ productId: string; productName: string; sent: boolean }> = []
    for (const tokenData of tokens) {
      if (tokenData.revoked) continue
      const product = PRODUCTS[tokenData.productId]
      if (!product) continue

      const { url, expiresAt } = await generateDownloadUrl({
        ownerUserId: operator.id,
        productId: tokenData.productId,
        customerEmail,
        transactionId: tokenData.transactionId,
        checkoutSessionId: tokenData.checkoutSessionId,
      })

      try {
        await sendFulfillmentEmail({ to: customerEmail, productName: product.name, downloadUrl: url, expiresAt })
        results.push({ productId: tokenData.productId, productName: product.name, sent: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[admin/reissue] Email failed for ${customerEmail}:`, message.slice(0, 100))
        results.push({ productId: tokenData.productId, productName: product.name, sent: false })
      }
    }

    try {
      const { logApprovalEvent } = await import('@/lib/approval-audit-log')
      await logApprovalEvent({
        missionId: 'first_real_customer',
        stageId: `reissue_${Date.now()}`,
        round: 1,
        agentRole: 'owner',
        agentId: 'owner',
        action: 'completed',
        feedback: `Reissued download link(s) to ${customerEmail}. Reason: ${reason}. Products: ${results.map((result) => result.productName).join(', ')}.`,
      })
    } catch {
      // Reissue remains successful even if the non-critical audit notification fails.
    }

    const sentCount = results.filter((result) => result.sent).length
    return NextResponse.json({
      ok: true,
      customerEmail,
      reissued: results,
      sentCount,
      totalCount: results.length,
      message: sentCount > 0
        ? `Re-sent ${sentCount} download link(s) to ${customerEmail}.`
        : `Found ${results.length} purchase(s) but email send failed. Check email configuration.`,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[admin/reissue] Error:', message.slice(0, 200))
    return NextResponse.json({ ok: false, error: message || 'Unknown error' }, { status: 500 })
  }
}
