import { NextRequest, NextResponse } from 'next/server'
import { confirmPasswordReset, requestPasswordReset } from '@/lib/auth'
import { checkRateLimitAsync, getClientIP } from '@/lib/rate-limiter'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const genericSuccess = () => NextResponse.json({
  ok: true,
  message: 'If an account exists for that email, a temporary reset code has been sent.',
})

export async function POST(req: NextRequest) {
  try {
    const limit = await checkRateLimitAsync(getClientIP(req), '/api/auth/password-reset')
    if (limit.limited) {
      return NextResponse.json(
        { ok: false, error: 'Too many password-reset requests. Please wait before trying again.' },
        { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000))) } },
      )
    }

    const body = await req.json().catch(() => ({}))
    const action = body?.action?.toString() ?? 'request'
    const email = body?.email?.toString() ?? ''

    if (action === 'request') {
      if (!email.trim()) return NextResponse.json({ ok: false, error: 'Email is required.' }, { status: 400 })
      const result = await requestPasswordReset(email)
      if (!result.sent && result.retryAfterSeconds) {
        return NextResponse.json({ ok: false, error: `Please wait ${result.retryAfterSeconds}s before requesting another code.` }, { status: 429 })
      }
      return genericSuccess()
    }

    if (action === 'confirm') {
      const code = body?.code?.toString().trim() ?? ''
      const newPassword = body?.newPassword?.toString() ?? ''
      const result = await confirmPasswordReset(email, code, newPassword)
      if (!result.ok) return NextResponse.json({ ok: false, error: result.error ?? 'Unable to reset password.' }, { status: 400 })
      return NextResponse.json({ ok: true, message: 'Password updated successfully. You can now sign in with your new password.' })
    }

    return NextResponse.json({ ok: false, error: 'Invalid password reset action.' }, { status: 400 })
  } catch (error) {
    console.error('[auth/password-reset] failed:', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ ok: false, error: 'Password reset is temporarily unavailable.' }, { status: 500 })
  }
}
