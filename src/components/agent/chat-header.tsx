'use client'

import { useEffect, useRef, useState } from 'react'
import { Menu, PanelLeft, PanelRight, Globe, ShieldCheck, LogOut, KeyRound, Loader2, AlertCircle, CheckCircle2, ChevronDown } from 'lucide-react'
import { useSession, signOut } from 'next-auth/react'
import { motion, AnimatePresence } from 'framer-motion'
import { useChatStore } from '@/store/chat-store'
import { NexusLogo } from './nexus-logo'

export function ChatHeader({
  onToggleLeft,
  onToggleRight,
}: {
  onToggleLeft: () => void
  onToggleRight: () => void
}) {
  const language = useChatStore((s) => s.language)
  const setLanguage = useChatStore((s) => s.setLanguage)
  const status = useChatStore((s) => s.status)
  const { data: session } = useSession()

  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [pwModalOpen, setPwModalOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close user menu on outside click
  useEffect(() => {
    if (!userMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [userMenuOpen])

  const email = session?.user?.email ?? 'operator'
  const displayName = session?.user?.name ?? email
  const initials = displayName.slice(0, 2).toUpperCase()

  return (
    <header className="sticky top-0 z-30 glass-strong border-b border-cyan-400/15 px-3 sm:px-4 py-2.5 flex items-center gap-3">
      {/* left toggle (mobile) */}
      <button
        onClick={onToggleLeft}
        className="md:hidden w-9 h-9 rounded-lg flex items-center justify-center text-cyan-300 hover:bg-cyan-400/10"
        aria-label="Toggle conversations"
      >
        <Menu className="w-4 h-4" />
      </button>
      <button
        onClick={onToggleLeft}
        className="hidden md:flex w-9 h-9 rounded-lg items-center justify-center text-cyan-300 hover:bg-cyan-400/10"
        aria-label="Toggle left sidebar"
        title="Toggle left sidebar"
      >
        <PanelLeft className="w-4 h-4" />
      </button>

      {/* logo / title */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <div className="hidden sm:block">
          <NexusLogo size={28} />
        </div>
        <div className="leading-tight min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-bold tracking-tight">
              <span className="neon-text-cyan">Agent007</span>{' '}
              <span className="neon-text-purple">AI</span>
            </h1>
            <span className="hidden sm:inline-flex text-[9px] px-1.5 py-0.5 rounded-full bg-cyan-400/10 border border-cyan-400/30 text-cyan-200 tracking-wider">
              INCOME OPERATOR
            </span>
          </div>
          <div className="text-[9px] text-[#5b6a92] tracking-wide hidden sm:block">
            {status === 'idle'
              ? 'Ready • +10% daily mission'
              : status === 'thinking'
              ? 'Reasoning…'
              : status === 'tool_running'
              ? 'Executing tools…'
              : 'Streaming response…'}
          </div>
        </div>
      </div>

      {/* language toggle */}
      <button
        onClick={() => setLanguage(language === 'en' ? 'zh' : 'en')}
        className="h-9 px-3 rounded-lg text-[11px] font-semibold tracking-wider glass border-cyan-400/30 hover:border-cyan-400/70 text-cyan-200 transition flex items-center gap-1.5"
        title="Toggle reply language"
        aria-label="Toggle language"
      >
        <Globe className="w-3.5 h-3.5" />
        <span className={language === 'en' ? 'text-cyan-300' : 'text-[#7c89b5]'}>EN</span>
        <span className="text-[#5b6a92]">/</span>
        <span className={language === 'zh' ? 'text-purple-300' : 'text-[#7c89b5]'}>中文</span>
      </button>

      {/* capabilities badge (desktop) */}
      <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-lg glass border-cyan-400/20 text-[10px] text-[#9bb5d4]">
        <ShieldCheck className="w-3 h-3 text-cyan-300" />
        <span>10 sub-agents • full web access • autonomous</span>
      </div>

      {/* user menu */}
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setUserMenuOpen((v) => !v)}
          className="flex items-center gap-1.5 h-9 px-2 rounded-lg glass border-cyan-400/30 hover:border-cyan-400/70 text-cyan-200 transition"
          aria-label="User menu"
          aria-haspopup="menu"
          aria-expanded={userMenuOpen}
        >
          <span className="w-6 h-6 rounded-full bg-cyan-400/15 border border-cyan-400/40 text-cyan-200 text-[10px] font-bold flex items-center justify-center">
            {initials}
          </span>
          <ChevronDown className={`w-3 h-3 text-[#9bb5d4] transition-transform ${userMenuOpen ? 'rotate-180' : ''}`} />
        </button>
        <AnimatePresence>
          {userMenuOpen && (
            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.96 }}
              transition={{ duration: 0.15 }}
              role="menu"
              className="absolute right-0 top-full mt-2 w-64 glass-strong rounded-xl p-2 z-40"
              style={{ borderColor: 'rgba(0,240,255,0.3)' }}
            >
              <div className="px-3 py-2.5 border-b border-cyan-400/15 mb-1">
                <div className="flex items-center gap-2">
                  <span className="w-8 h-8 rounded-full bg-cyan-400/15 border border-cyan-400/40 text-cyan-200 text-[11px] font-bold flex items-center justify-center">
                    {initials}
                  </span>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-[#e0e7ff] truncate">{displayName}</div>
                    <div className="text-[10px] text-[#7c89b5] truncate">{email}</div>
                  </div>
                </div>
              </div>
              <button
                onClick={() => {
                  setUserMenuOpen(false)
                  setPwModalOpen(true)
                }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-xs text-[#cfd9f0] hover:bg-cyan-400/10 transition"
                role="menuitem"
              >
                <KeyRound className="w-3.5 h-3.5 text-cyan-300" />
                Change Password
              </button>
              <button
                onClick={() => {
                  setUserMenuOpen(false)
                  signOut({ callbackUrl: '/login' })
                }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-xs text-pink-200 hover:bg-pink-400/10 transition"
                role="menuitem"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out
              </button>
              <div className="mt-1 pt-2 border-t border-cyan-400/10 px-3 text-[9px] text-[#5b6a92] tracking-wide">
                v2.0 • powered by Z.ai SDK
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* right toggle */}
      <button
        onClick={onToggleRight}
        className="hidden md:flex w-9 h-9 rounded-lg items-center justify-center text-cyan-300 hover:bg-cyan-400/10"
        aria-label="Toggle right sidebar"
        title="Toggle telemetry panel"
      >
        <PanelRight className="w-4 h-4" />
      </button>
      <button
        onClick={onToggleRight}
        className="md:hidden w-9 h-9 rounded-lg flex items-center justify-center text-cyan-300 hover:bg-cyan-400/10"
        aria-label="Toggle telemetry"
      >
        <PanelRight className="w-4 h-4" />
      </button>

      {/* change password modal */}
      <AnimatePresence>
        {pwModalOpen && (
          <ChangePasswordModal
            onClose={() => setPwModalOpen(false)}
          />
        )}
      </AnimatePresence>
    </header>
  )
}

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

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
        body: JSON.stringify({ currentPassword, newPassword }),
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
      className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 18, scale: 0.96 }}
        transition={{ duration: 0.2 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md glass-strong rounded-2xl p-6"
        style={{ borderColor: 'rgba(0,240,255,0.35)', boxShadow: '0 0 40px rgba(0,240,255,0.15)' }}
      >
        <div className="flex items-center gap-2 mb-1">
          <KeyRound className="w-5 h-5 text-cyan-300" />
          <h2 className="text-base font-bold text-[#e0e7ff]">Change Password</h2>
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
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 neon-btn-cyan rounded-lg py-2 text-xs font-bold tracking-wider flex items-center justify-center gap-2 disabled:opacity-60"
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
