'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertCircle, Loader2, Lock, Mail, MessageCircle, ShieldCheck, Smartphone } from 'lucide-react'

function LoginInner() {
  const router = useRouter()
  const search = useSearchParams()
  const callbackUrl = search.get('callbackUrl') || '/'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [requires2FA, setRequires2FA] = useState(false)
  const [twofaCode, setTwofaCode] = useState('')
  const [twofaUserId, setTwofaUserId] = useState('')
  const [twofaMethod, setTwofaMethod] = useState('email')
  const [twofaMessage, setTwofaMessage] = useState('')
  const [twofaToken, setTwofaToken] = useState('')
  const [twofaExpiresAt, setTwofaExpiresAt] = useState(0)
  const [twofaProof, setTwofaProof] = useState('')
  const [twofaProofExpiresAt, setTwofaProofExpiresAt] = useState(0)
  const [twofaWaLink, setTwofaWaLink] = useState('')
  const [resendCooldown, setResendCooldown] = useState(0)

  useEffect(() => {
    if (resendCooldown <= 0) return
    const timer = window.setTimeout(() => setResendCooldown((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [resendCooldown])

  useEffect(() => {
    const field = document.getElementById('agent007-email') as HTMLInputElement | null
    field?.focus()
  }, [])

  useEffect(() => {
    if (!requires2FA) return
    const field = document.getElementById('agent007-2fa-code') as HTMLInputElement | null
    field?.focus()
  }, [requires2FA])

  const startTwoFactorChallenge = async (normalizedEmail: string, rawPassword: string) => {
    const response = await fetch('/api/2fa/challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: normalizedEmail, password: rawPassword }),
    })
    const data = await response.json().catch(() => ({}))

    if (response.ok && data?.requiresTwoFactor) {
      setRequires2FA(true)
      setTwofaUserId(data.userId ?? '')
      setTwofaMethod(data.method ?? 'email')
      setTwofaMessage(data.message ?? `Verification code sent via ${data.method ?? 'email'}.`)
      setTwofaToken(data.token ?? '')
      setTwofaExpiresAt(Number(data.expiresAt ?? 0))
      setTwofaProof('')
      setTwofaProofExpiresAt(0)
      setTwofaWaLink(data.waLink ?? '')
      setTwofaCode('')
      setResendCooldown(30)
      return true
    }
    return false
  }

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (submitting) return

    setError('')
    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail || !password) {
      setError('Email and password are required.')
      return
    }

    setSubmitting(true)
    try {
      const requires2FA = await startTwoFactorChallenge(normalizedEmail, password)
      if (requires2FA) {
        setSubmitting(false)
        return
      }

      const result = await signIn('credentials', {
        email: normalizedEmail,
        password,
        redirect: false,
        callbackUrl,
      })

      if (!result || result.error) {
        setError('Invalid email or password.')
        setSubmitting(false)
        return
      }

      router.push(callbackUrl)
      router.refresh()
    } catch {
      setError('Sign-in failed. Please try again.')
      setSubmitting(false)
    }
  }

  const verify2FA = useCallback(async () => {
    if (submitting) return
    if (!twofaUserId || !twofaCode || twofaCode.length !== 6) {
      setError('Enter the 6-digit verification code.')
      return
    }

    setSubmitting(true)
    setError('')
    try {
      const verificationResponse = await fetch('/api/2fa/verify-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: twofaUserId, code: twofaCode, token: twofaToken, expiresAt: twofaExpiresAt }),
      })
      const verification = await verificationResponse.json().catch(() => ({}))
      if (!verificationResponse.ok || !verification.ok || !verification.proofToken || !verification.proofExpiresAt) {
        setError(verification.error ?? 'Invalid verification code.')
        setSubmitting(false)
        return
      }

      setTwofaProof(verification.proofToken)
      setTwofaProofExpiresAt(Number(verification.proofExpiresAt))

      const result = await signIn('credentials', {
        email: email.trim().toLowerCase(),
        password,
        twofaProof: verification.proofToken,
        twofaProofExpiresAt: String(verification.proofExpiresAt),
        redirect: false,
        callbackUrl,
      })

      if (!result || result.error) {
        setError('Verification succeeded, but sign-in failed. Please try again.')
        setSubmitting(false)
        return
      }

      router.push(callbackUrl)
      router.refresh()
    } catch {
      setError('Verification failed. Please try again.')
      setSubmitting(false)
    }
  }, [callbackUrl, email, password, router, submitting, twofaCode, twofaExpiresAt, twofaToken, twofaUserId])

  const resend2FA = async () => {
    if (resendCooldown > 0 || submitting) return
    setError('')
    try {
      const sent = await startTwoFactorChallenge(email.trim().toLowerCase(), password)
      if (!sent) {
        setError('Could not resend the verification code. Please sign in again.')
        return
      }
    } catch {
      setError('Could not resend the verification code.')
    }
  }

  const cancel2FA = () => {
    setRequires2FA(false)
    setTwofaCode('')
    setTwofaUserId('')
    setTwofaToken('')
    setTwofaExpiresAt(0)
    setTwofaProof('')
    setTwofaProofExpiresAt(0)
    setTwofaWaLink('')
    setTwofaMessage('')
    setError('')
    setSubmitting(false)
  }

  return (
    <main className="min-h-screen bg-black text-[#e0e7ff] flex items-center justify-center px-4 py-8">
      <section className="w-full max-w-sm rounded-2xl border border-cyan-400/25 bg-[#07101f] p-6 shadow-2xl shadow-cyan-500/10">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-cyan-300">Agent007 AI</h1>
          <p className="mt-1 text-xs text-[#7c89b5]">{requires2FA ? 'Two-Factor Verification' : 'Sign in to your executive system'}</p>
        </div>

        {requires2FA ? (
          <form onSubmit={(event) => { event.preventDefault(); void verify2FA() }} className="space-y-4">
            <div className="rounded-lg border border-cyan-400/20 bg-cyan-400/5 px-3 py-2 text-xs text-cyan-100">
              {twofaMessage || 'Verification code sent to your email.'}
            </div>
            {twofaWaLink && (
              <a href={twofaWaLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-xs text-emerald-300 hover:text-emerald-200">
                {twofaMethod === 'whatsapp' ? <MessageCircle className="h-4 w-4" /> : <Smartphone className="h-4 w-4" />}
                Open verification channel
              </a>
            )}
            <label htmlFor="agent007-2fa-code" className="block text-xs font-medium text-[#9aa7cc]">Verification code</label>
            <div className="relative">
              <ShieldCheck className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-300/70" />
              <input id="agent007-2fa-code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={twofaCode}
                onChange={(event) => { setTwofaCode(event.target.value.replace(/\D/g, '').slice(0, 6)); setError('') }}
                className="w-full rounded-lg border border-white/10 bg-black/30 py-3 pl-9 pr-3 text-center text-lg tracking-[0.45em] outline-none focus:border-cyan-400/60"
                placeholder="000000" required />
            </div>
            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200" role="alert">
                <AlertCircle className="h-4 w-4 shrink-0" />{error}
              </div>
            )}
            <button type="submit" disabled={submitting || twofaCode.length !== 6} className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-400 py-3 text-sm font-bold text-black disabled:opacity-50">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              {submitting ? 'VERIFYING…' : 'VERIFY & SIGN IN'}
            </button>
            <div className="flex items-center justify-between text-xs">
              <button type="button" onClick={cancel2FA} className="text-[#7c89b5] hover:text-white">Back to sign in</button>
              <button type="button" disabled={resendCooldown > 0 || submitting} onClick={() => void resend2FA()} className="text-cyan-300 hover:text-cyan-200 disabled:opacity-40">
                {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label htmlFor="agent007-email" className="mb-1.5 block text-xs font-medium text-[#9aa7cc]">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-300/70" />
                <input id="agent007-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="w-full rounded-lg border border-white/10 bg-black/30 py-3 pl-9 pr-3 text-sm outline-none focus:border-cyan-400/60" placeholder="you@example.com" required />
              </div>
            </div>
            <div>
              <label htmlFor="agent007-password" className="mb-1.5 block text-xs font-medium text-[#9aa7cc]">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-300/70" />
                <input id="agent007-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-lg border border-white/10 bg-black/30 py-3 pl-9 pr-3 text-sm outline-none focus:border-cyan-400/60" placeholder="Your password" required />
              </div>
            </div>
            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200" role="alert">
                <AlertCircle className="h-4 w-4 shrink-0" />{error}
              </div>
            )}
            <button type="submit" disabled={submitting} className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-400 py-3 text-sm font-bold text-black disabled:opacity-50">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              {submitting ? 'SIGNING IN…' : 'SIGN IN'}
            </button>
          </form>
        )}
      </section>
    </main>
  )
}

export default function LoginPage() {
  return <Suspense fallback={null}><LoginInner /></Suspense>
}