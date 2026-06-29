import { NextRequest, NextResponse } from 'next/server'
import { registerUser } from '@/lib/session-user'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/register
 * Body: { email, password, name? }
 *
 * Creates a new user account. After registration, the client should call
 * signIn('credentials', { email, password }) to authenticate.
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
    message: 'Account created. You can now sign in.',
  })
}
