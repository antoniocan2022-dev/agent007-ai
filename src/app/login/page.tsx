'use client'

import { useState, useEffect, Suspense } from 'react'
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
} from 'lucide-react'
import { NexusLogo } from '@/components/agent/nexus-logo'

/** Import SEED_EMAIL from auth.ts (client-side-safe constant) */
const SEED_EMAIL = 'antonio.can2022@hotmail.com'

function LoginInner() {
  const router = useRouter()
  const search = useSearchParams()
  const callbackUrl = search.get('callbackUrl') ?? '/'

  const [email, setEmail] = useState(SEED_EMAIL)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [requires2FA, setRequires2FA] = useState(false)
  const [twofaCode, setTwofaCode] = useState('')
  const [twofaUserId, setTwofaUserId] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Forgot-password modal state
  const [forgotOpen, setForgotOpen] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resetMsg, setResetMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  // small UX nudge: focus the password field on mount (email is pre-filled)
  useEffect(() => {
    const t = setTimeout(() => {
      const el = document.getElementById('agent007-password') as HTMLInputElement | null
      el?.focus()
    }, 300)
    const verify2FA = async () => {
    if (!twofaCode || !twofaUserId) return
    setSubmitting(true)
    setError('')
    try {
      const verifyRes = await fetch('/api/2fa/verify-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: twofaUserId, code: twofaCode }),
      })
      const verifyData = await verifyRes.json()
      if (verifyData.ok) {
        // 2FA verified — sign in with twofaVerified flag
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
  }

  return () => clearTimeout(t)
  }, [])

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
      const res = await signIn('credentials', {
        email: email.trim().toLowerCase(),
        password,
        redirect: false,
        callbackUrl,
      })
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
        className="relative z-10 w-full max-w-md glass-strong rounded-2xl p-7 sm:p-9"
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
            Authorized Access Only • Your AI Income Operator
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          {/* email */}
          <div>
            <label htmlFor="agent007-email" className="block text-[10px] tracking-[0.2em] text-[#7c89b5] mb-1.5 font-semibold">
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
              <label htmlFor="agent007-password" className="block text-[10px] tracking-[0.2em] text-[#7c89b5] font-semibold">
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

        <p className="mt-4 text-center text-[10px] text-[#5b6a92] tracking-wide">
          v2.0 • powered by Z.ai SDK • multi-user • PWA • voice I/O
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
