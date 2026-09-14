import { NextRequest, NextResponse } from 'next/server'
import { registerUser } from '@/lib/session-user'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/register
 * Body: { email, password, name? }
 *
 * Creates a new user account. Unless this is the owner's own account (SEED_EMAIL), the account
 * requires explicit owner approval (see user-approval.ts) before signIn('credentials', ...) will
 * succeed -- registerUser() sends the owner an approval request as part of this call.
 */
export async function POST(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { email, password, name } = body as {
    email?: string
    password?: string
    name?: string
  }

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
  }

  const result = await registerUser(email, password, name)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({
    ok: true,
    user: result.user,
    pendingApproval: result.pendingApproval ?? false,
    message: result.pendingApproval
      ? 'Account created. The owner has been notified and must approve this account before you can sign in.'
      : 'Account created. You can now sign in.',
  })
}
