import { NextRequest, NextResponse } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'
import { hashPassword, SEED_EMAIL } from '@/lib/auth'
import crypto from 'node:crypto'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// In-memory reset tokens (expires in 15 min)
const _g: any = globalThis as any
if (!_g.__resetTokens) _g.__resetTokens = new Map<string, { email: string; expiresAt: number }>()

/**
 * POST /api/auth/reset-password
 * Body: { email } → sends confirmation link to email
 * Body: { email, newPassword, token } → resets password (requires token)
 */
export async function POST(req: NextRequest) {
  await ensureDbReady().catch(() => {})
  try {
    const body = await req.json()
    const email = (body.email ?? SEED_EMAIL).toString().trim().toLowerCase()
    
    // Phase 1: Request reset → generate token + send email
    if (!body.newPassword && !body.token) {
      const user = await db.user.findUnique({ where: { email } })
      if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })
      
      const token = crypto.randomUUID()
      _g.__resetTokens.set(token, { email, expiresAt: Date.now() + 15 * 60 * 1000 })
      
      // Send confirmation link via email
      try {
        const { sendEmail } = await import('@/lib/email')
        const resetLink = `https://agent007-ai.vercel.app/login?reset=${token}&email=${encodeURIComponent(email)}`
        await sendEmail({
          to: email,
          subject: '🔐 Agent007 Password Reset Confirmation',
          body: `Hello Antonio,\n\nYou requested a password reset for Agent007 AI.\n\nClick this link to confirm and reset your password:\n${resetLink}\n\nThis link expires in 15 minutes.\n\nIf you didn't request this, ignore this email.\n\n— Agent007 AI`,
          userId: user.id,
          type: 'reset',
        })
      } catch {}
      
      // Also generate a wa.me link as fallback
      const waLink = `https://wa.me/15145496297?text=${encodeURIComponent('Agent007 password reset requested. Check your email for confirmation link.')}`
      
      return NextResponse.json({ 
        ok: true, 
        message: 'Confirmation link sent to ' + email + '. Check your inbox (and spam folder).',
        waLink,
        token, // return token for direct use if email doesn't work
      })
    }
    
    // Phase 2: Confirm reset → verify token + set new password
    if (body.newPassword && body.token) {
      const stored = _g.__resetTokens.get(body.token.toString())
      if (!stored) return NextResponse.json({ error: 'Invalid or expired token. Request a new reset.' }, { status: 400 })
      if (Date.now() > stored.expiresAt) {
        _g.__resetTokens.delete(body.token.toString())
        return NextResponse.json({ error: 'Token expired. Request a new reset.' }, { status: 400 })
      }
      if (stored.email !== email) return NextResponse.json({ error: 'Email mismatch' }, { status: 400 })
      
      const newPassword = body.newPassword.toString()
      if (newPassword.length < 8) return NextResponse.json({ error: 'Password must be 8+ characters' }, { status: 400 })
      
      const passwordHash = await hashPassword(newPassword)
      const user = await db.user.findUnique({ where: { email } })
      if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })
      
      await db.user.update({ where: { id: user.id }, data: { passwordHash } })
      _g.__resetTokens.delete(body.token.toString())
      
      return NextResponse.json({ ok: true, message: '✅ Password reset successfully. You can now sign in with your new password.' })
    }
    
    return NextResponse.json({ error: 'Provide email for reset link, or email + newPassword + token to confirm.' }, { status: 400 })
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }) }
}
