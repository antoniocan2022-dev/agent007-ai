'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Menu,
  PanelLeft,
  PanelRight,
  Globe,
  ShieldCheck,
  LogOut,
  KeyRound,
  ChevronDown,
  MessageSquare,
  LayoutDashboard,
  CalendarClock,
  Settings as SettingsIcon,
  Rocket,
  type LucideIcon,
} from 'lucide-react'
import { useSession, signOut } from 'next-auth/react'
import { motion, AnimatePresence } from 'framer-motion'
import { useChatStore } from '@/store/chat-store'
import { NexusLogo } from './nexus-logo'
import { ApiStatusIndicator } from './api-status-indicator'

type TabId = 'chat' | 'dashboard' | 'schedules' | 'settings' | 'missions'

interface TabDef {
  id: TabId
  label: string
  icon: LucideIcon
}

const TABS: TabDef[] = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'missions', label: 'Missions', icon: Rocket },
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'schedules', label: 'Schedules', icon: CalendarClock },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
]

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
  const activeTab = useChatStore((s) => s.activeTab)
  const setActiveTab = useChatStore((s) => s.setActiveTab)
  const setChangePasswordOpen = useChatStore((s) => s.setChangePasswordOpen)
  const { data: session } = useSession()

  const [userMenuOpen, setUserMenuOpen] = useState(false)
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
    <header className="sticky top-0 z-30 glass-strong border-b border-cyan-400/15">
      {/* Top row: toggles + logo + actions */}
      <div className="px-3 sm:px-4 py-2.5 flex items-center gap-3">
        {/* left toggle (mobile) */}
        <button
          onClick={onToggleLeft}
          className="md:hidden w-9 h-9 rounded-lg flex items-center justify-center text-cyan-300 hover:bg-cyan-400/10"
          aria-label="Toggle conversations"
          style={{ touchAction: 'manipulation' }}
        >
          <Menu className="w-4 h-4" />
        </button>
        <button
          onClick={onToggleLeft}
          className="hidden md:flex w-9 h-9 rounded-lg items-center justify-center text-cyan-300 hover:bg-cyan-400/10"
          aria-label="Toggle left sidebar"
          title="Toggle left sidebar"
          style={{ touchAction: 'manipulation' }}
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
          style={{ touchAction: 'manipulation' }}
        >
          <Globe className="w-3.5 h-3.5" />
          <span className={language === 'en' ? 'text-cyan-300' : 'text-[#7c89b5]'}>EN</span>
          <span className="text-[#5b6a92]">/</span>
          <span className={language === 'zh' ? 'text-purple-300' : 'text-[#7c89b5]'}>中文</span>
        </button>

        {/* capabilities badge (desktop) — with API status indicator */}
        <div className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 rounded-lg glass border-cyan-400/20 text-[10px] text-[#9bb5d4]">
          <ApiStatusIndicator />
          <ShieldCheck className="w-3 h-3 text-cyan-300" />
          <span>12 sub-agents • full web access • autonomous</span>
        </div>

        {/* API status indicator (mobile/tablet) — shown separately when xl hidden */}
        <div className="xl:hidden">
          <ApiStatusIndicator compact />
        </div>

        {/* user menu */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setUserMenuOpen((v) => !v)}
            className="flex items-center gap-1.5 h-9 px-2 rounded-lg glass border-cyan-400/30 hover:border-cyan-400/70 text-cyan-200 transition"
            aria-label="User menu"
            aria-haspopup="menu"
            aria-expanded={userMenuOpen}
            style={{ touchAction: 'manipulation' }}
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
                    setActiveTab('settings')
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-xs text-[#cfd9f0] hover:bg-cyan-400/10 transition"
                  role="menuitem"
                  style={{ touchAction: 'manipulation' }}
                >
                  <SettingsIcon className="w-3.5 h-3.5 text-cyan-300" />
                  Open Settings
                </button>
                <button
                  onClick={() => {
                    setUserMenuOpen(false)
                    setChangePasswordOpen(true)
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-xs text-[#cfd9f0] hover:bg-cyan-400/10 transition"
                  role="menuitem"
                  style={{ touchAction: 'manipulation' }}
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
                  style={{ touchAction: 'manipulation' }}
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
          style={{ touchAction: 'manipulation' }}
        >
          <PanelRight className="w-4 h-4" />
        </button>
        <button
          onClick={onToggleRight}
          className="md:hidden w-9 h-9 rounded-lg flex items-center justify-center text-cyan-300 hover:bg-cyan-400/10"
          aria-label="Toggle telemetry"
          style={{ touchAction: 'manipulation' }}
        >
          <PanelRight className="w-4 h-4" />
        </button>
      </div>

      {/* Tab navigation row — horizontally scrollable on mobile */}
      <div className="px-3 sm:px-4 pb-2 -mt-1">
        <nav
          className="flex items-center gap-1 overflow-x-auto scroll-cyan pb-0.5"
          role="tablist"
          aria-label="Main navigation"
          style={{ scrollbarWidth: 'none' }}
        >
          {TABS.map((tab) => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(tab.id)}
                className={`relative flex items-center gap-1.5 h-8 px-3 sm:px-4 rounded-lg text-[11px] sm:text-xs font-semibold tracking-wider transition whitespace-nowrap flex-shrink-0 ${
                  isActive
                    ? 'text-cyan-200 bg-cyan-400/10 border border-cyan-400/40'
                    : 'text-[#7c89b5] border border-transparent hover:text-cyan-200 hover:bg-cyan-400/5'
                }`}
                style={{ touchAction: 'manipulation' }}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label.toUpperCase()}
                {isActive && (
                  <motion.span
                    layoutId="tab-underline"
                    className="absolute left-2 right-2 -bottom-0.5 h-0.5 rounded-full"
                    style={{
                      background: 'linear-gradient(90deg, #00f0ff, #a855f7)',
                      boxShadow: '0 0 8px rgba(0,240,255,0.7)',
                    }}
                  />
                )}
              </button>
            )
          })}
        </nav>
      </div>
    </header>
  )
}
