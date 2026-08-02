'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { KeyRound, Loader2, AlertCircle, CheckCircle2, X } from 'lucide-react'
import { useChatStore } from '@/store/chat-store'

/**
 * Global Change-Password modal. Mounted once at the page level. Triggered by
 * either the chat-header user menu or the Settings tab via the shared
 * `changePasswordOpen` flag in the chat store.
 */
export function ChangePasswordModal() {
  const open = useChatStore((s) => s.changePasswordOpen)
  const setOpen = useChatStore((s) => s.setChangePasswordOpen)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  if (!open) return null

  const onClose = () => {
    if (submitting) return
    setOpen(false)
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setError('')
    setSuccess('')
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return
    setError('')
    setSuccess('')
    if (!currentPassword || !newPassword || !confirmPassword) {
      setError('All three fields are required.')
      return
    }
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.')
      return
    }
    if (newPassword === currentPassword) {
      setError('New password must differ from the current password.')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword, email: 'OWNER_EMAIL' }),
      })
      const data = await res.json().catch(() => ({ ok: false, error: 'Request failed' }))
      if (!res.ok || !data.ok) {
        setError(data.error ?? `Failed (HTTP ${res.status})`)
        setSubmitting(false)
        return
      }
      setSuccess('Password updated. You will stay signed in on this device.')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setSubmitting(false)
      setTimeout(() => onClose(), 1800)
    } catch (e: any) {
      setError(e?.message ?? 'Network error.')
      setSubmitting(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
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
            <h2 className="text-base font-bold text-[#e0e7ff]">Change Password</h2>
          </div>
          <button
            onClick={onClose}
            className="sm:hidden text-[#7c89b5] hover:text-cyan-300 p-1"
            aria-label="Close"
            style={{ touchAction: 'manipulation' }}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-[11px] text-[#7c89b5] mb-4">
          Update your Agent007 operator credentials. Min 8 characters.
        </p>

        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label className="block text-[10px] tracking-[0.2em] text-[#7c89b5] mb-1 font-semibold">CURRENT</label>
            <input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full glass rounded-lg px-3 py-2 text-sm text-[#e0e7ff] outline-none focus:border-cyan-400/70 transition"
              placeholder="••••••••"
              required
              autoFocus
            />
          </div>
          <div>
            <label className="block text-[10px] tracking-[0.2em] text-[#7c89b5] mb-1 font-semibold">NEW</label>
            <input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full glass rounded-lg px-3 py-2 text-sm text-[#e0e7ff] outline-none focus:border-cyan-400/70 transition"
              placeholder="••••••••"
              required
            />
          </div>
          <div>
            <label className="block text-[10px] tracking-[0.2em] text-[#7c89b5] mb-1 font-semibold">CONFIRM</label>
            <input
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full glass rounded-lg px-3 py-2 text-sm text-[#e0e7ff] outline-none focus:border-cyan-400/70 transition"
              placeholder="••••••••"
              required
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-pink-500/10 border border-pink-400/40 text-pink-200 text-xs">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {success && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-400/40 text-emerald-200 text-xs">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              <span>{success}</span>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-3 py-2 rounded-lg text-xs font-semibold glass border-cyan-400/20 text-[#cfd9f0] hover:border-cyan-400/40 transition"
              style={{ touchAction: 'manipulation' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 neon-btn-cyan rounded-lg py-2 text-xs font-bold tracking-wider flex items-center justify-center gap-2 disabled:opacity-60"
              style={{ touchAction: 'manipulation' }}
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  SAVING…
                </>
              ) : (
                'UPDATE PASSWORD'
              )}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  )
}
