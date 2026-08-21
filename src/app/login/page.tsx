'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertCircle, ArrowLeft, CheckCircle2, KeyRound, Loader2, Lock, Mail, MessageCircle, ShieldCheck, Smartphone } from 'lucide-react'

type TwoFactorChallengeResult =
  | { status: 'required' }
  | { status: 'not-required' }
  | { status: 'error'; message: string }

type ResetStep = 'request' | 'confirm'

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
  const [twofaWaLink, setTwofaWaLink] = useState('')
  const [resendCooldown, setResendCooldown] = useState(0)

  const [resetMode, setResetMode] = useState(false)
  const [resetStep, setResetStep] = useState<ResetStep>('request')
  const [resetCode, setResetCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [resetMessage, setResetMessage] = useState('')
  const [resetBusy, setResetBusy] = useState(false)

  useEffect(() => {
    if (resendCooldown <= 0) return
    const timer = window.setTimeout(() => setResendCooldown((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [resendCooldown])

  useEffect(() => {
    const field = document.getElementById(resetMode ? (resetStep === 'request' ? 'agent007-reset-email' : 'agent007-reset-code') : requires2FA ? 'agent007-2fa-code' : 'agent007-email') as HTMLInputElement | null
    field?.focus()
  }, [requires2FA, resetMode, resetStep])

  const startTwoFactorChallenge = async (normalizedEmail: string, rawPassword: string): Promise<TwoFactorChallengeResult> => {
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
      setTwofaWaLink(data.waLink ?? '')
      setTwofaCode('')
      setResendCooldown(30)
      return { status: 'required' }
    }

    if (!response.ok && response.status !== 401) {
      return { status: 'error', message: data?.error ?? 'Unable to start two-factor verification.' }
    }

    return { status: 'not-required' }
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
      const challenge = await startTwoFactorChallenge(normalizedEmail, password)
      if (challenge.status === 'required') {
        setSubmitting(false)
        return
      }
      if (challenge.status === 'error') {
        setError(challenge.message)
        setSubmitting(false)
        return
      }

      const result = await signIn('credentials', { email: normalizedEmail, password, redirect: false, callbackUrl })
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
      const result = await startTwoFactorChallenge(email.trim().toLowerCase(), password)
      if (result.status === 'error') setError(result.message)
      else if (result.status !== 'required') setError('Could not resend the verification code. Please sign in again.')
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
    setTwofaWaLink('')
    setTwofaMessage('')
    setError('')
    setSubmitting(false)
  }

  const openReset = () => {
    setResetMode(true)
    setResetStep('request')
    setResetCode('')
    setNewPassword('')
    setResetMessage('')
    setError('')
    setRequires2FA(false)
  }

  const closeReset = () => {
    setResetMode(false)
    setResetStep('request')
    setResetCode('')
    setNewPassword('')
    setResetMessage('')
    setError('')
    setResetBusy(false)
  }

  const requestResetCode = async () => {
    if (resetBusy) return
    setError('')
    setResetMessage('')
    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail) {
      setError('Enter your email address first.')
      return
    }

    setResetBusy(true)
    try {
      const response = await fetch('/api/auth/password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'request', email: normalizedEmail }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data?.error ?? 'Unable to send the reset code.')
        setResetBusy(false)
        return
      }
      setResetStep('confirm')
      setResetMessage('Check your email for the temporary 6-digit password reset code. The code expires in 10 minutes.')
    } catch {
      setError('Unable to send the reset code. Please try again.')
    } finally {
      setResetBusy(false)
    }
  }

  const confirmReset = async () => {
    if (resetBusy) return
    setError('')
    setResetMessage('')
    if (!/^\d{6}$/.test(resetCode)) {
      setError('Enter the 6-digit reset code from your email.')
      return
    }
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.')
      return
    }

    setResetBusy(true)
    try {
      const response = await fetch('/api/auth/password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm', email: email.trim().toLowerCase(), code: resetCode, newPassword }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data?.ok) {
        setError(data?.error ?? 'Unable to reset password.')
        setResetBusy(false)
        return
      }
      setResetMessage('Password updated successfully. You can now sign in with your new password.')
      setResetCode('')
      setNewPassword('')
      setResetStep('request')
    } catch {
      setError('Unable to reset password. Please try again.')
    } finally {
      setResetBusy(false)
    }
  }

  return (
    <main className="min-h-screen bg-black text-[#e0e7ff] flex items-center justify-center px-4 py-8">
      <section className="w-full max-w-sm rounded-2xl border border-cyan-400/25 bg-[#07101f] p-6 shadow-2xl shadow-cyan-500/10">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-cyan-300">Agent007 AI</h1>
          <p className="mt-1 text-xs text-[#7c89b5]">
            {resetMode ? 'Reset your password' : requires2FA ? 'Two-Factor Verification' : 'Sign in to your executive system'}
          </p>
        </div>

        {resetMode ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-cyan-400/20 bg-cyan-400/5 px-3 py-3 text-xs leading-5 text-cyan-100">
              {resetStep === 'request'
                ? 'Enter your account email. We will send one temporary 6-digit code. The code expires after 10 minutes.'
                : 'Enter the 6-digit code from your email and choose a new password.'}
            </div>

            {resetMessage && (
              <div className="flex items-start gap-2 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200" role="status">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{resetMessage}</span>
              </div>
            )}

            <div>
              <label htmlFor="agent007-reset-email" className="mb-1.5 block text-xs font-medium text-[#9aa7cc]">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-300/70" />
                <input id="agent007-reset-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="w-full rounded-lg border border-white/10 bg-black/30 py-3 pl-9 pr-3 text-sm outline-none focus:border-cyan-400/60" placeholder="you@example.com" required />
              </div>
            </div>

            {resetStep === 'confirm' && (
              <>
                <div>
                  <label htmlFor="agent007-reset-code" className="mb-1.5 block text-xs font-medium text-[#9aa7cc]">Temporary code</label>
                  <div className="relative">
                    <KeyRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-300/70" />
                    <input id="agent007-reset-code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={resetCode} onChange={(event) => { setResetCode(event.target.value.replace(/\D/g, '').slice(0, 6)); setError('') }} className="w-full rounded-lg border border-white/10 bg-black/30 py-3 pl-9 pr-3 text-center text-lg tracking-[0.45em] outline-none focus:border-cyan-400/60" placeholder="000000" />
                  </div>
                </div>
                <div>
                  <label htmlFor="agent007-new-password" className="mb-1.5 block text-xs font-medium text-[#9aa7cc]">New password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-300/70" />
                    <input id="agent007-new-password" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => { setNewPassword(event.target.value); setError('') }} className="w-full rounded-lg border border-white/10 bg-black/30 py-3 pl-9 pr-3 text-sm outline-none focus:border-cyan-400/60" placeholder="At least 8 characters" />
                  </div>
                </div>
              </>
            )}

            {error && <div className="flex items-center gap-2 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200" role="alert"><AlertCircle className="h-4 w-4 shrink-0" />{error}</div>}

            <button type="button" onClick={() => void (resetStep === 'request' ? requestResetCode() : confirmReset())} disabled={resetBusy} className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-400 py-3 text-sm font-bold text-black disabled:opacity-50">
              {resetBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : resetStep === 'request' ? <Mail className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
              {resetBusy ? 'PLEASE WAIT…' : resetStep === 'request' ? 'SEND RESET CODE' : 'RESET PASSWORD'}
            </button>

            <div className="flex items-center justify-between text-xs">
              <button type="button" onClick={closeReset} className="inline-flex items-center gap-1 text-[#7c89b5] hover:text-white"><ArrowLeft className="h-3.5 w-3.5" />Back to sign in</button>
              {resetStep === 'confirm' && <button type="button" onClick={() => { setResetStep('request'); setResetMessage(''); setError('') }} className="text-cyan-300 hover:text-cyan-200">Request new code</button>}
            </div>
          </div>
        ) : requires2FA ? (
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
            {error && <div className="flex items-center gap-2 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200" role="alert"><AlertCircle className="h-4 w-4 shrink-0" />{error}</div>}
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
            <div><label htmlFor="agent007-email" className="mb-1.5 block text-xs font-medium text-[#9aa7cc]">Email</label><div className="relative"><Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-300/70" /><input id="agent007-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="w-full rounded-lg border border-white/10 bg-black/30 py-3 pl-9 pr-3 text-sm outline-none focus:border-cyan-400/60" placeholder="you@example.com" required /></div></div>
            <div><label htmlFor="agent007-password" className="mb-1.5 block text-xs font-medium text-[#9aa7cc]">Password</label><div className="relative"><Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-300/70" /><input id="agent007-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-lg border border-white/10 bg-black/30 py-3 pl-9 pr-3 text-sm outline-none focus:border-cyan-400/60" placeholder="Your password" required /></div></div>
            {error && <div className="flex items-center gap-2 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200" role="alert"><AlertCircle className="h-4 w-4 shrink-0" />{error}</div>}
            <button type="submit" disabled={submitting} className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-400 py-3 text-sm font-bold text-black disabled:opacity-50">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              {submitting ? 'SIGNING IN…' : 'SIGN IN'}
            </button>
            <button type="button" onClick={openReset} className="flex w-full items-center justify-center gap-2 text-xs text-cyan-300 hover:text-cyan-200">
              <KeyRound className="h-3.5 w-3.5" /> Forgot password? / Reset password
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
