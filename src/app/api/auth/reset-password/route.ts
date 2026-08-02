import { NextRequest, NextResponse } from 'next/server'
import { requestOwnerAuthorization, verifyOwnerAuthorization } from '@/lib/owner-auth'
import { db, ensureDbReady } from '@/lib/db'
import { hashPassword, SEED_EMAIL } from '@/lib/auth'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const _g: any = globalThis as any
if (!_g.__resetCodes) _g.__resetCodes = new Map<string, { code: string; email: string; expiresAt: number }>()

/**
 * POST /api/auth/reset-password
 * 
 * Phase 1: { email } → generate 6-digit code, send via email + WhatsApp, return success
 * Phase 2: { email, code, newPassword } → verify code, set new password
 */
export async function POST(req: NextRequest) {
  await ensureDbReady().catch(() => {})
  try {
    const body = await req.json()
    const email = (body.email ?? SEED_EMAIL).toString().trim().toLowerCase()

    // Phase 2: Verify code + set new password
    if (body.code && body.newPassword) {
      const code = body.code.toString()
      const newPassword = body.newPassword.toString()
      
      if (newPassword.length < 8) return NextResponse.json({ error: 'Password must be 8+ characters' }, { status: 400 })
      
      const stored = _g.__resetCodes.get(email)
      if (!stored) return NextResponse.json({ error: 'No reset code found. Request a new code.' }, { status: 400 })
      if (Date.now() > stored.expiresAt) {
        _g.__resetCodes.delete(email)
        return NextResponse.json({ error: 'Code expired. Request a new code.' }, { status: 400 })
      }
      if (code !== stored.code) return NextResponse.json({ error: 'Invalid code. Try again.' }, { status: 400 })
      
      const user = await db.user.findUnique({ where: { email } })
      if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })
      
      const passwordHash = await hashPassword(newPassword)
      await db.user.update({ where: { id: user.id }, data: { passwordHash } })
      _g.__resetCodes.delete(email)
      
      return NextResponse.json({ ok: true, message: '✅ Password updated successfully! You can now sign in with your new password.' })
    }

    // Phase 1: Generate code + send via email
    const user = await db.user.findUnique({ where: { email } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })
    
    const code = Math.floor(100000 + Math.random() * 900000).toString()
    _g.__resetCodes.set(email, { code, email, expiresAt: Date.now() + 10 * 60 * 1000 }) // 10 min expiry
    
    let emailSent = false
    let emailError = ''
    
    // Try sending via SMTP
    try {
      const { sendEmail } = await import('@/lib/email')
      await sendEmail({
        to: email,
        subject: '🔐 Agent007 — Password Reset Code',
        body: `Hello Antonio,\n\nYour password reset code is: ${code}\n\nThis code expires in 10 minutes.\n\nEnter this code on the reset page to set your new password.\n\nIf you didn't request this reset, ignore this email.\n\n— Agent007 AI`,
        userId: user.id,
        type: 'reset',
      })
      emailSent = true
    } catch (e: any) {
      emailError = e?.message ?? 'SMTP failed'
    }
    
    // Also try WhatsApp as backup
    let whatsappSent = false
    try {
      const { sendWhatsApp } = await import('@/lib/whatsapp-bridge')
      const waResult = await sendWhatsApp({ userId: user.id, to: 'OWNER_PHONE', message: `🔐 Agent007 Password Reset Code: ${code}\n\nThis code expires in 10 minutes.` })
      whatsappSent = waResult.ok
    } catch {}
    
    // Generate wa.me link as manual fallback
    const waLink = `https://wa.me/OWNER_PHONE_DIGITS?text=${encodeURIComponent('Agent007 reset code: ' + code)}`
    
    return NextResponse.json({
      ok: true,
      emailSent,
      whatsappSent,
      emailError: emailSent ? null : emailError,
      waLink,
      message: emailSent 
        ? `✅ Reset code sent to ${email}. Check your inbox (and spam folder).`
        : whatsappSent
          ? `✅ Reset code sent via WhatsApp to OWNER_PHONE.`
          : `⚠ Email delivery failed (${emailError}). Use this code: ${code}`,
      // Always return the code as fallback (so the UI can show it if email fails)
      code: emailSent ? undefined : code,
    })
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }) }
}
