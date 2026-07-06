import { NextRequest, NextResponse } from 'next/server'
import { processApproval } from '@/lib/user-approval'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/auth/approve?token=<token>&action=approve|reject
 *
 * Called when the owner clicks the approval link in their email/WhatsApp/SMS.
 * Processes the approval (or rejection) and returns an HTML page showing
 * the result.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const token = url.searchParams.get('token')
  const action = (url.searchParams.get('action') ?? 'approve') as 'approve' | 'reject'

  if (!token) {
    return new NextResponse(
      `<html><body style="font-family:sans-serif;text-align:center;padding:40px;">
        <h1 style="color:#ef4444;">❌ Missing Token</h1>
        <p>The approval link is invalid — no token provided.</p>
      </body></html>`,
      { status: 400, headers: { 'Content-Type': 'text/html' } }
    )
  }

  const result = await processApproval({ token, action })

  const isSuccess = result.ok
  const bgColor = isSuccess ? '#10b981' : '#ef4444'
  const icon = isSuccess ? (action === 'approve' ? '✅' : '❌') : '⚠️'

  return new NextResponse(
    `<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;text-align:center;padding:60px 20px;background:#0a0e27;color:#e0e7ff;min-height:100vh;">
      <div style="max-width:500px;margin:0 auto;background:#151a2e;padding:40px;border-radius:16px;border:1px solid ${bgColor}40;">
        <div style="font-size:48px;margin-bottom:16px;">${icon}</div>
        <h1 style="color:${bgColor};margin-bottom:16px;font-size:24px;">
          ${isSuccess ? (action === 'approve' ? 'User Approved' : 'User Rejected') : 'Approval Failed'}
        </h1>
        <p style="color:#a0aec0;line-height:1.6;margin-bottom:24px;">${result.message}</p>
        <a href="https://agent007-ai.vercel.app" style="display:inline-block;background:#06b6d4;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
          Return to Agent007
        </a>
      </div>
    </body></html>`,
    {
      status: isSuccess ? 200 : 400,
      headers: { 'Content-Type': 'text/html' },
    }
  )
}
