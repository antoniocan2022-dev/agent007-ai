'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Loader2 } from 'lucide-react'
import { useChatStore } from '@/store/chat-store'
import { Background } from '@/components/agent/background'
import { ChatHeader } from '@/components/agent/chat-header'
import { AgentProgressBanner } from '@/components/agent/agent-progress-banner'
import { SidebarLeft } from '@/components/agent/sidebar-left'
import { SidebarRight } from '@/components/agent/sidebar-right'
import { NexusLogo } from '@/components/agent/nexus-logo'
import { ChatTab } from '@/components/agent/tabs/chat-tab'
import { DashboardTab } from '@/components/agent/tabs/dashboard-tab'
import { SchedulesTab } from '@/components/agent/tabs/schedules-tab'
import { SettingsTab } from '@/components/agent/tabs/settings-tab'
import { MissionsTab } from '@/components/agent/tabs/missions-tab'
import { ChangePasswordModal } from '@/components/agent/change-password-modal'
import { PwaInstallPrompt } from '@/components/agent/pwa-install-prompt'

export default function Home() {
  const { status } = useSession()
  const router = useRouter()
  const [leftOpenMobile, setLeftOpenMobile] = useState(false)
  const [rightOpenMobile, setRightOpenMobile] = useState(false)
  // Tablet (768-1023px): right sidebar collapses to a drawer by default
  const [rightOpenTablet, setRightOpenTablet] = useState(false)

  const leftOpen = useChatStore((s) => s.leftOpen)
  const rightOpen = useChatStore((s) => s.rightOpen)
  const toggleLeft = useChatStore((s) => s.toggleLeft)
  const toggleRight = useChatStore((s) => s.toggleRight)
  const loadConversations = useChatStore((s) => s.loadConversations)
  const loadMemories = useChatStore((s) => s.loadMemories)
  const loadSubagentCount = useChatStore((s) => s.loadSubagentCount)
  const conversations = useChatStore((s) => s.conversations)
  const activeTab = useChatStore((s) => s.activeTab)
  const startAutoRefresh = useChatStore((s) => s.startAutoRefresh)

  // Redirect to /login when unauthenticated.
  // UPGRADE #90 — Immediate redirect (no loading screen flash).
  // If status is 'unauthenticated', redirect IMMEDIATELY before rendering anything.
  useEffect(() => {
    if (status === 'unauthenticated') {
      // Use window.location for instant redirect (no client-side router delay)
      if (typeof window !== 'undefined') {
        window.location.replace('/login')
      } else {
        router.replace('/login')
      }
    }
  }, [status, router])

  // UPGRADE #90 — While checking auth status, show MINIMAL loading screen
  // (not the full background + UI) to avoid the "dashboard flash" before redirect.
  if (status === 'loading' || status === 'unauthenticated') {
    return (
      <div className="relative min-h-screen flex flex-col items-center justify-center bg-black overflow-hidden">
        {/* Minimal loading — no Background component to avoid heavy asset load */}
        <div className="relative z-10 flex flex-col items-center">
          <div className="hex-pulse mb-5">
            <NexusLogo size={72} />
          </div>
          <div className="flex items-center gap-2 text-cyan-300 text-sm tracking-[0.25em] font-semibold">
            <Loader2 className="w-4 h-4 animate-spin" />
            {status === 'unauthenticated' ? 'REDIRECTING TO LOGIN…' : 'BOOTING AGENT007…'}
          </div>
        </div>
      </div>
    )
  }

  // Initial load (only after we know the user is authenticated)
  useEffect(() => {
    if (status !== 'authenticated') return
    loadConversations()
    loadMemories()
    loadSubagentCount()
    startAutoRefresh()
  }, [status, loadConversations, loadMemories, loadSubagentCount, startAutoRefresh])

  // (Loading/unauthenticated rendering handled above — no duplicate here)

  // Decide whether the desktop right sidebar should be visible inline.
  // - Desktop (>=1024px): use the store flag (rightOpen), inline
  // - Tablet (768-1023px): collapse to a slide-in drawer (rightOpenTablet)
  // - Mobile (<768px): drawer (rightOpenMobile)
  // We achieve this by only rendering the desktop sidebar at lg+ and using
  // the drawer markup at md and below.
  const onToggleRight = () => {
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      // Tablet or mobile — open the right drawer
      if (window.innerWidth < 768) setRightOpenMobile((v) => !v)
      else setRightOpenTablet((v) => !v)
    } else {
      toggleRight()
    }
  }

  return (
    <div className="relative min-h-screen flex flex-col bg-black">
      <Background />

      <div className="relative z-10 flex-1 flex flex-col min-h-0">
        <ChatHeader
          onToggleLeft={() => {
            if (typeof window !== 'undefined' && window.innerWidth < 768) {
              setLeftOpenMobile((v) => !v)
            } else {
              toggleLeft()
            }
          }}
          onToggleRight={onToggleRight}
        />

        <div className="flex-1 flex min-h-0 relative">
          {/* Left sidebar - desktop */}
          <AnimatePresenceHelper
            show={leftOpen}
            desktopKey="left-desktop"
            mobileKey="left-mobile"
            mobileOpen={leftOpenMobile}
            onMobileClose={() => setLeftOpenMobile(false)}
            mobileWidth={260}
            desktopWidth={240}
            side="left"
            renderContent={() => <SidebarLeft />}
            renderMobileContent={(onClose) => <SidebarLeft onClose={onClose} />}
          />

          {/* Center column — renders the active tab */}
          <main className="flex-1 flex flex-col min-w-0 min-h-0">
            {/* UPGRADE #63 — Real-time progress banner */}
            <AgentProgressBanner />
            {activeTab === 'chat' && <ChatTab />}
            {activeTab === 'missions' && <MissionsTab />}
            {activeTab === 'dashboard' && <DashboardTab />}
            {activeTab === 'schedules' && <SchedulesTab />}
            {activeTab === 'settings' && (
              <SettingsTab
                onOpenChangePassword={() =>
                  useChatStore.getState().setChangePasswordOpen(true)
                }
              />
            )}
          </main>

          {/* Right sidebar - desktop inline (lg+ only) */}
          <AnimatePresenceHelper
            show={rightOpen}
            desktopKey="right-desktop"
            mobileKey="right-mobile"
            mobileOpen={rightOpenMobile}
            onMobileClose={() => setRightOpenMobile(false)}
            mobileWidth={280}
            desktopWidth={300}
            side="right"
            // Hide the desktop right sidebar on tablet (md) — only show on lg+
            desktopClassName="hidden lg:block"
            renderContent={() => <SidebarRight />}
            renderMobileContent={(onClose) => <SidebarRight onClose={onClose} />}
          />

          {/* Tablet right drawer (md only, 768-1023px) */}
          <AnimatePresenceHelper
            show={false}
            desktopKey="right-tablet-placeholder"
            mobileKey="right-tablet"
            mobileOpen={rightOpenTablet}
            onMobileClose={() => setRightOpenTablet(false)}
            mobileWidth={300}
            desktopWidth={0}
            side="right"
            // Only render at tablet (md, not lg)
            mobileClassName="md:block lg:hidden"
            renderContent={() => <SidebarRight />}
            renderMobileContent={(onClose) => <SidebarRight onClose={onClose} />}
          />
        </div>
      </div>

      {/* Global Change-Password modal — mounted once, openable from anywhere */}
      <ChangePasswordModal />

      {/* PWA install prompt — shows when browser fires beforeinstallprompt */}
      <PwaInstallPrompt />

      {/* Hidden state-keeper so conversations load on mount even if unused */}
      <span className="hidden" aria-hidden>
        {conversations.length}
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Local helper that mirrors the original animated sidebar markup so we
 * don't duplicate AnimatePresence boilerplate for left + right panels.
 * ------------------------------------------------------------------ */
import { AnimatePresence } from 'framer-motion'
import { motion as Motion } from 'framer-motion'

function AnimatePresenceHelper({
  show,
  desktopKey,
  mobileKey,
  mobileOpen,
  onMobileClose,
  desktopWidth,
  mobileWidth,
  side,
  renderContent,
  renderMobileContent,
  desktopClassName,
  mobileClassName,
}: {
  show: boolean
  desktopKey: string
  mobileKey: string
  mobileOpen: boolean
  onMobileClose: () => void
  desktopWidth: number
  mobileWidth: number
  side: 'left' | 'right'
  renderContent: () => React.ReactNode
  renderMobileContent: (onClose: () => void) => React.ReactNode
  desktopClassName?: string
  mobileClassName?: string
}) {
  return (
    <>
      {/* Desktop */}
      <AnimatePresence initial={false}>
        {show && desktopWidth > 0 && (
          <Motion.aside
            key={desktopKey}
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: desktopWidth, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className={`flex-shrink-0 overflow-hidden ${desktopClassName ?? 'hidden md:block'}`}
          >
            <div style={{ width: desktopWidth }} className="h-full">
              {renderContent()}
            </div>
          </Motion.aside>
        )}
      </AnimatePresence>

      {/* Mobile / tablet drawer */}
      <AnimatePresence initial={false}>
        {mobileOpen && (
          <>
            <Motion.div
              key={`${mobileKey}-overlay`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onMobileClose}
              className={`fixed inset-0 bg-black/70 backdrop-blur-sm z-40 ${mobileClassName ?? 'md:hidden'}`}
            />
            <Motion.aside
              key={mobileKey}
              initial={{ x: side === 'left' ? -300 : 320 }}
              animate={{ x: 0 }}
              exit={{ x: side === 'left' ? -300 : 320 }}
              transition={{ type: 'spring', damping: 25, stiffness: 220 }}
              className={`fixed top-0 bottom-0 z-50 ${side === 'left' ? 'left-0' : 'right-0'} ${mobileClassName ?? 'md:hidden'}`}
              style={{ width: mobileWidth }}
            >
              {renderMobileContent(onMobileClose)}
            </Motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
