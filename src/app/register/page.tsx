'use client'

import { useState, Suspense } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { Loader2, Lock, Mail, User, ShieldCheck, AlertCircle, UserPlus } from 'lucide-react'
import { NexusLogo } from '@/components/agent/nexus-logo'

function RegisterInner() {
  const router = useRouter()
  const search = useSearchParams()
  const callbackUrl = search.get('callbackUrl') ?? '/'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return
    setError('')

    if (!email.trim() || !password) {
      setError('Email and password are required.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setSubmitting(true)
    try {
      // 1) Create the account
      const regRes = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password, name: name.trim() || undefined }),
      })
      const regData = await regRes.json().catch(() => ({}))
      if (!regRes.ok || !regData.ok) {
        setError(regData.error || `Registration failed (HTTP ${regRes.status})`)
        setSubmitting(false)
        return
      }

      // 2) Sign in immediately
      const signRes = await signIn('credentials', {
        email: email.trim().toLowerCase(),
        password,
        redirect: false,
        callbackUrl,
      })
      if (!signRes || signRes.error) {
        setError('Account created, but auto-sign-in failed. Please sign in manually.')
        router.push('/login')
        return
      }
      router.push(callbackUrl)
      router.refresh()
    } catch (e: any) {
      setError(e?.message ?? 'Registration failed. Try again.')
      setSubmitting(false)
    }
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center px-4 py-10 overflow-hidden bg-black">
      {/* animated background orbs */}
      <div className="orb orb-cyan orb-1" style={{ width: 380, height: 380, top: -120, left: -100 }} aria-hidden />
      <div className="orb orb-purple orb-2" style={{ width: 460, height: 460, top: '20vh', right: -160 }} aria-hidden />

      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.55, ease: 'easeOut' }}
        className="relative z-10 w-full max-w-md glass-strong rounded-2xl p-7 sm:p-9"
        style={{ borderColor: 'rgba(0,240,255,0.35)', boxShadow: '0 0 40px rgba(0,240,255,0.15)' }}
      >
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
            Create your operator account
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-[10px] tracking-[0.2em] text-[#7c89b5] mb-1.5 font-semibold">
              NAME (OPTIONAL)
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-cyan-300/70" />
              <input
                type="text"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full glass rounded-lg pl-9 pr-3 py-2.5 text-sm text-[#e0e7ff] placeholder:text-[#5b6a92] outline-none focus:border-cyan-400/70 transition"
                placeholder="Your name"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] tracking-[0.2em] text-[#7c89b5] mb-1.5 font-semibold">
              EMAIL
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-cyan-300/70" />
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full glass rounded-lg pl-9 pr-3 py-2.5 text-sm text-[#e0e7ff] placeholder:text-[#5b6a92] outline-none focus:border-cyan-400/70 transition"
                placeholder="you@example.com"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] tracking-[0.2em] text-[#7c89b5] mb-1.5 font-semibold">
              PASSWORD (MIN 8 CHARS)
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-cyan-300/70" />
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full glass rounded-lg pl-9 pr-3 py-2.5 text-sm text-[#e0e7ff] placeholder:text-[#5b6a92] outline-none focus:border-cyan-400/70 transition"
                placeholder="••••••••"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] tracking-[0.2em] text-[#7c89b5] mb-1.5 font-semibold">
              CONFIRM PASSWORD
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-cyan-300/70" />
              <input
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full glass rounded-lg pl-9 pr-3 py-2.5 text-sm text-[#e0e7ff] placeholder:text-[#5b6a92] outline-none focus:border-cyan-400/70 transition"
                placeholder="••••••••"
                required
              />
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
            disabled={submitting}
            className="w-full neon-btn-cyan rounded-lg py-2.5 text-sm font-bold tracking-wider flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                CREATING ACCOUNT…
              </>
            ) : (
              <>
                <UserPlus className="w-4 h-4" />
                CREATE ACCOUNT
              </>
            )}
          </button>
        </form>

        <div className="mt-6 text-center text-xs text-[#7c89b5]">
          Already have an account?{' '}
          <button
            onClick={() => router.push('/login')}
            className="text-cyan-300 hover:text-cyan-200 font-semibold tracking-wide"
            style={{ touchAction: 'manipulation' }}
          >
            Sign in
          </button>
        </div>

        <p className="mt-4 text-center text-[10px] text-[#5b6a92] tracking-wide">
          v2.0 • powered by Z.ai SDK • multi-user • PWA
        </p>
      </motion.div>
    </div>
  )
}

export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterInner />
    </Suspense>
  )
}
