'use client'

import { useState, useEffect, Suspense } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { Loader2, Lock, Mail, ShieldCheck, AlertCircle } from 'lucide-react'
import { NexusLogo } from '@/components/agent/nexus-logo'

function LoginInner() {
  const router = useRouter()
  const search = useSearchParams()
  const callbackUrl = search.get('callbackUrl') ?? '/'

  const [email, setEmail] = useState('antonio.can2022@hotmail.com')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // small UX nudge: focus the password field on mount (email is pre-filled)
  useEffect(() => {
    const t = setTimeout(() => {
      const el = document.getElementById('agent007-password') as HTMLInputElement | null
      el?.focus()
    }, 300)
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
        setError('Invalid email or password. Access denied.')
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
            <label htmlFor="agent007-password" className="block text-[10px] tracking-[0.2em] text-[#7c89b5] mb-1.5 font-semibold">
              PASSWORD
            </label>
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

        <p className="mt-6 text-center text-[10px] text-[#5b6a92] tracking-wide">
          v2.0 • powered by Z.ai SDK • 10 sub-agents • full web access
        </p>
      </motion.div>
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
