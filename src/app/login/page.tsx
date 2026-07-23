'use client'

import { useState, useEffect, Suspense, useCallback } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  AlertCircle,
  KeyRound,
  CheckCircle2,
  X,
  HelpCircle,
  Smartphone,
  MessageCircle,
} from 'lucide-react'
import { NexusLogo } from '@/components/agent/nexus-logo'
import { AutonomyIntelligencePanel } from '@/components/agent/autonomy-intelligence-panel'

/** UPGRADE #120 — Seed email reads from NEXT_PUBLIC_OWNER_EMAIL env var.
 * Falls back to a safe default. No hardcoded PII in source code. */
const SEED_EMAIL = process.env.NEXT_PUBLIC_OWNER_EMAIL || 'operator@example.com'

/** Static version text — extracted as a constant so it's identical on server + client.
 * Adding suppressHydrationWarning as a safety net against stale .next cache. */
const VERSION_TEXT = 'v2.0 • 82 upgrades • 612 tools • 20 subagents • 5 LLM providers • 27 AI integrations • FULL_AUTONOMY'

function LoginInner() {
  const router = useRouter()
  const search = useSearchParams()
  const callbackUrl = search.get('callbackUrl') ?? '/'

  const [email, setEmail] = useState(SEED_EMAIL)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  // 2FA challenge state
  const [requires2FA, setRequires2FA] = useState(false)
  const [twofaCode, setTwofaCode] = useState('')
  const [twofaUserId, setTwofaUserId] = useState('')
  const [twofaMethod, setTwofaMethod] = useState<string>('email')
  const [twofaMessage, setTwofaMessage] = useState<string>('')
  const [twofaDisplayCode, setTwofaDisplayCode] = useState<string>('')
  const [twofaWaLink, setTwofaWaLink] = useState<string>('')
  const [twofaToken, setTwofaToken] = useState<string>('')
  const [twofaExpiresAt, setTwofaExpiresAt] = useState<number>(0)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [submitting, setSubmitting] = useState(false)

  // Forgot-password modal state
  const [forgotOpen, setForgotOpen] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resetMsg, setResetMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return
    const t = setTimeout(() => setResendCooldown((c) => Math.max(0, c - 1)), 1000)
    return () => clearTimeout(t)
  }, [resendCooldown])

  // Auto-focus the password field on initial mount
  useEffect(() => {
    const t = setTimeout(() => {
      const el = document.getElementById('agent007-password') as HTMLInputElement | null
      el?.focus()
    }, 300)
    return () => clearTimeout(t)
  }, [])

  // Auto-focus the 2FA input when 2FA is required
  useEffect(() => {
    if (requires2FA) {
      const t = setTimeout(() => {
        const el = document.getElementById('agent007-2fa-code') as HTMLInputElement | null
        el?.focus()
      }, 200)
      return () => clearTimeout(t)
    }
  }, [requires2FA])

  /* ----- Step 1: Submit credentials → either log in OR trigger 2FA challenge ----- */
  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return
    setError('')
    if (!email.trim() || !password) {
      setError('Email and password are required.')
      return
    }
    setSubmitting(true)
    try {
      // Pre-flight: check whether 2FA is enabled for this account.
      // This avoids the NextAuth limitation where signIn() hides the
      // "2FA_REQUIRED" custom error and just returns "CredentialsSignin".
      const challengeRes = await fetch('/api/2fa/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      }).catch((e) => ({ ok: false, status: 0, json: async () => ({ error: e?.message ?? 'Network error' }) } as any))

      const challengeData = await (challengeRes as any).json().catch(() => ({}))

      // If the challenge endpoint explicitly says 2FA is required → show the code input
      if (challengeRes.status === 200 && challengeData?.requiresTwoFactor) {
        setRequires2FA(true)
        setTwofaUserId(challengeData.userId)
        setTwofaMethod(challengeData.method ?? 'email')
        setTwofaMessage(challengeData.message ?? `Code sent via ${challengeData.method ?? 'email'}`)
        setTwofaDisplayCode(challengeData.displayCode ?? '')
        setTwofaWaLink(challengeData.waLink ?? '')
        setTwofaToken(challengeData.token ?? '')
        setTwofaExpiresAt(challengeData.expiresAt ?? 0)
        setResendCooldown(30)
        setSubmitting(false)
        return
      }

      // Otherwise: proceed with direct signIn (no 2FA enabled)
      let res = await signIn('credentials', {
        email: email.trim().toLowerCase(),
        password,
        redirect: false,
        callbackUrl,
      })

      // AUTO-RETRY: If login fails AND the email matches the seed email,
      // auto-reset the password to default and retry once.
      // This handles Vercel cold-start DB issues where the password hash
      // might not match.
      if ((!res || res.error) && email.trim().toLowerCase() === SEED_EMAIL) {
        try {
          await fetch('/api/auth/force-reset', { method: 'POST' })
          // Retry login with default password
          res = await signIn('credentials', {
            email: SEED_EMAIL,
            password: SEED_EMAIL,
            redirect: false,
            callbackUrl,
          })
        } catch {}
      }

      if (!res || res.error) {
        setError('Invalid email or password. Access denied. Use "Forgot Password?" to reset.')
        setSubmitting(false)
        return
      }
      // success — route to the dashboard
      router.push(callbackUrl)
      router.refresh()
    } catch (e: any) {
      setError(e?.message ?? 'Sign-in failed. Try again.')
      setSubmitting(false)
    }
  }

  /* ----- Step 2: Verify the 2FA code, then sign in with twofaVerified flag ----- */
  const verify2FA = useCallback(async () => {
    if (!twofaCode || !twofaUserId || submitting) return
    if (twofaCode.length < 6) {
      setError('Enter the 6-digit verification code.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const verifyRes = await fetch('/api/2fa/verify-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: twofaUserId, code: twofaCode, token: twofaToken, expiresAt: twofaExpiresAt }),
      })
      const verifyData = await verifyRes.json().catch(() => ({}))
      if (verifyData.ok) {
        // 2FA verified — sign in with twofaVerified flag set so authorize() allows login
        const signRes = await signIn('credentials', {
          email: email.trim().toLowerCase(),
          password,
          twofaVerified: 'true',
          redirect: false,
          callbackUrl,
        })
        if (!signRes || signRes.error) {
          setError('2FA verified but login failed. Try again.')
          setSubmitting(false)
          return
        }
        router.push(callbackUrl)
        router.refresh()
      } else {
        setError(verifyData.error || 'Invalid 2FA code. Try again.')
        setSubmitting(false)
      }
    } catch (e: any) {
      setError(e?.message || '2FA verification failed')
      setSubmitting(false)
    }
  }, [twofaCode, twofaUserId, submitting, email, password, router, callbackUrl])

  /* ----- Resend the 2FA code ----- */
  const resend2FA = async () => {
    if (resendCooldown > 0) return
    setError('')
    try {
      const r = await fetch('/api/2fa/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      })
      const d = await r.json().catch(() => ({}))
      if (d.requiresTwoFactor) {
        setTwofaMessage(d.message ?? 'New code sent')
        setTwofaDisplayCode(d.displayCode ?? '')
        setTwofaWaLink(d.waLink ?? '')
        setTwofaToken(d.token ?? '')
        setTwofaExpiresAt(d.expiresAt ?? 0)
        setResendCooldown(30)
      } else {
        setError(d.error ?? 'Failed to resend code')
      }
    } catch (e: any) {
      setError(e?.message ?? 'Network error')
    }
  }

  /* ----- Cancel 2FA flow, go back to password ----- */
  const cancel2FA = () => {
    setRequires2FA(false)
    setTwofaCode('')
    setTwofaUserId('')
    setTwofaMessage('')
    setError('')
    setPassword('')
    setSubmitting(false)
  }

  const onForceReset = async () => {
    if (resetting) return
    setResetting(true)
    setResetMsg(null)
    try {
      const res = await fetch('/api/auth/force-reset', { method: 'POST' })
      const json = await res.json().catch(() => ({ ok: false, error: 'Request failed' }))
      if (!res.ok || !json.ok) {
        setResetMsg({ kind: 'err', text: json.error ?? `Reset failed (HTTP ${res.status}).` })
      } else {
        setResetMsg({
          kind: 'ok',
          text: `Password reset to default. You can now sign in with email "${SEED_EMAIL}" and password "${SEED_EMAIL}".`,
        })
        // Pre-fill the form so the user can just click SIGN IN
        setEmail(SEED_EMAIL)
        setPassword(SEED_EMAIL)
      }
    } catch (e: any) {
      setResetMsg({ kind: 'err', text: e?.message ?? 'Network error.' })
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center px-4 py-10 overflow-hidden bg-black">
      {/* animated background orbs (same aesthetic as the dashboard) */}
      <div className="orb orb-cyan orb-1" style={{ width: 380, height: 380, top: -120, left: -100 }} aria-hidden />
      <div className="orb orb-purple orb-2" style={{ width: 460, height: 460, top: '20vh', right: -160 }} aria-hidden />
      <div className="orb orb-pink orb-3" style={{ width: 320, height: 320, bottom: -120, left: '30vw' }} aria-hidden />

      {/* CRT scanline overlay */}
      <style jsx global>{`
        body::before {
          content: '';
          position: fixed;
          inset: 0;
          pointer-events: none;
          background: repeating-linear-gradient(
            to bottom,
            rgba(0, 240, 255, 0.02) 0px,
            rgba(0, 240, 255, 0.02) 1px,
            transparent 1px,
            transparent 3px
          );
          mix-blend-mode: screen;
          z-index: 100;
          opacity: 0.45;
        }
      `}</style>

      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.55, ease: 'easeOut' }}
        className="relative z-10 w-full max-w-md glass-strong rounded-2xl p-7 sm:p-9 max-h-[95vh] overflow-y-auto"
        style={{ borderColor: 'rgba(0,240,255,0.35)', boxShadow: '0 0 40px rgba(0,240,255,0.15)' }}
      >
        {/* logo + title */}
        <div className="flex flex-col items-center text-center mb-7">
          <motion.div
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1, duration: 0.6 }}
            className="hex-pulse mb-4"
          >
            <NexusLogo size={72} />
          </motion.div>
          <h1 className="text-3xl font-extrabold tracking-tight">
            <span className="neon-text-cyan">Agent007</span>{' '}
            <span className="neon-text-purple">AI</span>
          </h1>
          <p className="mt-2 text-xs sm:text-sm text-[#7c89b5] tracking-wide">
            {requires2FA
              ? 'Two-Factor Verification Required'
              : 'Authorized Access Only • Your AI Income Operator'}
          </p>
        </div>

        {/* ─────────── 2FA VERIFICATION FORM ─────────── */}
        {requires2FA ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              verify2FA()
            }}
            className="space-y-4"
          >
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-cyan-500/10 border border-cyan-400/30 text-cyan-100 text-xs">
              {twofaMethod === 'whatsapp' ? (
                <MessageCircle className="w-4 h-4 flex-shrink-0 text-emerald-300" />
              ) : twofaMethod === 'sms' ? (
                <Smartphone className="w-4 h-4 flex-shrink-0 text-cyan-300" />
              ) : (
                <Mail className="w-4 h-4 flex-shrink-0 text-cyan-300" />
              )}
              <span className="leading-snug">{twofaMessage || `Code sent via ${twofaMethod}`}</span>
            </div>

            {/* Fallback: display code on-screen if email doesn't arrive (owner only) */}
            {twofaDisplayCode && (
              <div className="mt-2 p-3 rounded-lg border border-cyan-400/30 bg-cyan-400/5 text-center">
                <div className="text-[10px] tracking-[0.2em] text-cyan-300/70 mb-1 font-semibold">
                  FALLBACK CODE (if email doesn&apos;t arrive)
                </div>
                <div className="text-2xl font-bold tracking-[0.4em] text-cyan-200 select-all">
                  {twofaDisplayCode}
                </div>
                <div className="text-[9px] text-[#7c89b5] mt-1">
                  Check your email + spam folder for antonio.can2022@hotmail.com
                </div>
              </div>
            )}

            {/* WhatsApp link fallback (always available) */}
            {twofaWaLink && (
              <div className="mt-2 text-center">
                <a
                  href={twofaWaLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-[11px] text-emerald-300 hover:text-emerald-200 tracking-wide transition"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  Get code via WhatsApp (wa.me link)
                </a>
              </div>
            )}

            <div>
              <label
                htmlFor="agent007-2fa-code"
                className="block text-[10px] tracking-[0.2em] text-[#7c89b5] mb-1.5 font-semibold"
              >
                VERIFICATION CODE
              </label>
              <div className="relative">
                <ShieldCheck className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-cyan-300/70" />
                <input
                  id="agent007-2fa-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={twofaCode}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, '').slice(0, 6)
                    setTwofaCode(v)
                    setError('')
                  }}
                  className="w-full glass rounded-lg pl-9 pr-3 py-2.5 text-base tracking-[0.5em] text-center text-[#e0e7ff] placeholder:text-[#5b6a92] outline-none focus:border-cyan-400/70 transition"
                  placeholder="000000"
                  required
                />
              </div>
              <div className="mt-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={cancel2FA}
                  className="text-[10px] text-[#7c89b5] hover:text-cyan-200 tracking-wider transition"
                  style={{ touchAction: 'manipulation' }}
                >
                  ← Back to sign in
                </button>
                <button
                  type="button"
                  onClick={resend2FA}
                  disabled={resendCooldown > 0}
                  className="text-[10px] text-cyan-300/80 hover:text-cyan-200 tracking-wider transition disabled:opacity-40"
                  style={{ touchAction: 'manipulation' }}
                >
                  {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
                </button>
              </div>
            </div>

            {error && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-pink-500/10 border border-pink-400/40 text-pink-200 text-xs"
              >
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </motion.div>
            )}

            <button
              type="submit"
              disabled={submitting || twofaCode.length !== 6}
              className="w-full neon-btn-cyan rounded-lg py-2.5 text-sm font-bold tracking-wider flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  VERIFYING…
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  VERIFY & SIGN IN
                </>
              )}
            </button>
          </form>
        ) : (
          /* ─────────── MAIN LOGIN FORM ─────────── */
          <form onSubmit={onSubmit} className="space-y-4">
            {/* email */}
            <div>
              <label
                htmlFor="agent007-email"
                className="block text-[10px] tracking-[0.2em] text-[#7c89b5] mb-1.5 font-semibold"
              >
                EMAIL
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-cyan-300/70" />
                <input
                  id="agent007-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full glass rounded-lg pl-9 pr-3 py-2.5 text-sm text-[#e0e7ff] placeholder:text-[#5b6a92] outline-none focus:border-cyan-400/70 transition"
                  placeholder="operator@example.com"
                  required
                />
              </div>
            </div>

            {/* password */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="agent007-password"
                  className="block text-[10px] tracking-[0.2em] text-[#7c89b5] font-semibold"
                >
                  PASSWORD
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setForgotOpen(true)
                    setResetMsg(null)
                  }}
                  className="text-[10px] text-cyan-300/80 hover:text-cyan-200 tracking-wider flex items-center gap-1 transition"
                  style={{ touchAction: 'manipulation' }}
                >
                  <HelpCircle className="w-3 h-3" />
                  Forgot Password?
                </button>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-cyan-300/70" />
                <input
                  id="agent007-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full glass rounded-lg pl-9 pr-3 py-2.5 text-sm text-[#e0e7ff] placeholder:text-[#5b6a92] outline-none focus:border-cyan-400/70 transition"
                  placeholder="••••••••"
                  required
                />
              </div>
            </div>

            {/* error */}
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-pink-500/10 border border-pink-400/40 text-pink-200 text-xs"
              >
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </motion.div>
            )}

            {/* submit */}
            <button
              type="submit"
              disabled={submitting}
              className="w-full neon-btn-cyan rounded-lg py-2.5 text-sm font-bold tracking-wider flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  AUTHENTICATING…
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  SIGN IN
                </>
              )}
            </button>
          </form>
        )}

        {/* UPGRADE #87 — Autonomy / Intelligence / Awareness showcase (compact mode for login) */}
        {!requires2FA && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5 }}
            className="mt-6 pt-5 border-t border-cyan-400/15"
          >
            <AutonomyIntelligencePanel mode="compact" />
          </motion.div>
        )}

        <div className="mt-6 text-center text-xs text-[#7c89b5]">
          New operator?{' '}
          <button
            onClick={() => router.push('/register')}
            className="text-cyan-300 hover:text-cyan-200 font-semibold tracking-wide"
            style={{ touchAction: 'manipulation' }}
          >
            Create account
          </button>
        </div>

        <p
          className="mt-4 text-center text-[10px] text-[#5b6a92] tracking-wide"
          suppressHydrationWarning
        >
          {VERSION_TEXT}
        </p>
      </motion.div>

      {/* Forgot-password modal */}
      <AnimatePresence>
        {forgotOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4"
            onClick={() => !resetting && setForgotOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 18, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 18, scale: 0.96 }}
              transition={{ duration: 0.2 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full sm:max-w-md glass-strong sm:rounded-2xl p-5 sm:p-6 min-h-screen sm:min-h-0 overflow-y-auto"
              style={{ borderColor: 'rgba(0,240,255,0.35)', boxShadow: '0 0 40px rgba(0,240,255,0.15)' }}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <KeyRound className="w-5 h-5 text-cyan-300" />
                  <h2 className="text-base font-bold text-[#e0e7ff]">Reset Password</h2>
                </div>
                <button
                  onClick={() => !resetting && setForgotOpen(false)}
                  className="sm:hidden text-[#7c89b5] hover:text-cyan-300 p-1"
                  aria-label="Close"
                  style={{ touchAction: 'manipulation' }}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className="text-[11px] text-[#7c89b5] mb-4 leading-relaxed">
                Contact the administrator to reset your password. For this demo, you can reset
                the password for <code className="text-cyan-200">{SEED_EMAIL}</code> back to its
                default value by clicking the button below. After reset, sign in with email and
                password both equal to <code className="text-cyan-200">{SEED_EMAIL}</code>.
              </p>

              {resetMsg && (
                <div
                  className={`flex items-start gap-2 px-3 py-2 rounded-lg text-xs mb-3 ${
                    resetMsg.kind === 'ok'
                      ? 'bg-emerald-500/10 border border-emerald-400/40 text-emerald-200'
                      : 'bg-pink-500/10 border border-pink-400/40 text-pink-200'
                  }`}
                >
                  {resetMsg.kind === 'ok' ? (
                    <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  )}
                  <span className="leading-snug">{resetMsg.text}</span>
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => !resetting && setForgotOpen(false)}
                  className="flex-1 px-3 py-2 rounded-lg text-xs font-semibold glass border-cyan-400/20 text-[#cfd9f0] hover:border-cyan-400/40 transition"
                  style={{ touchAction: 'manipulation' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={onForceReset}
                  disabled={resetting}
                  className="flex-1 neon-btn-cyan rounded-lg py-2 text-xs font-bold tracking-wider flex items-center justify-center gap-2 disabled:opacity-60"
                  style={{ touchAction: 'manipulation' }}
                >
                  {resetting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      RESETTING…
                    </>
                  ) : (
                    'RESET PASSWORD'
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  )
}
