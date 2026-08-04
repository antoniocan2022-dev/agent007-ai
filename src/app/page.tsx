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
// UPGRADE #156 Fix 4+5: Lazy-load heavy tabs to reduce initial JS bundle.
// Before: all tabs imported eagerly → 1.5MB JS bundle loaded on every page.
// After: only ChatTab loads immediately (primary view). Other tabs load on demand.
// This cuts ~500-800KB from the initial bundle (recharts + framer-motion only
// load when the Dashboard tab is opened).
import dynamic from 'next/dynamic'

// DEBUG-SLOW-TABS fix: Show a loading spinner during chunk download instead of
// a blank screen. Before: `loading: () => null` rendered NOTHING while the JS
// chunk (recharts + framer-motion + tab code) downloaded — users saw a blank
// center panel for 1-5s and thought the tab was broken/slow.
// After: a centered spinner with "Loading X…" so the user knows work is happening.
const TabLoader = ({ label }: { label: string }) => (
  <div className="flex-1 flex flex-col items-center justify-center text-[#7c89b5] gap-3">
    <Loader2 className="w-6 h-6 animate-spin text-cyan-300" />
    <span className="text-xs tracking-wider">{label}</span>
  </div>
)
const DashboardTab = dynamic(() => import('@/components/agent/tabs/dashboard-tab').then(m => ({ default: m.DashboardTab })), { loading: () => <TabLoader label="Loading dashboard…" /> })
const SchedulesTab = dynamic(() => import('@/components/agent/tabs/schedules-tab').then(m => ({ default: m.SchedulesTab })), { loading: () => <TabLoader label="Loading schedules…" /> })
const SettingsTab = dynamic(() => import('@/components/agent/tabs/settings-tab').then(m => ({ default: m.SettingsTab })), { loading: () => <TabLoader label="Loading settings…" /> })
const MissionsTab = dynamic(() => import('@/components/agent/tabs/missions-tab').then(m => ({ default: m.MissionsTab })), { loading: () => <TabLoader label="Loading missions…" /> })
const PodsTab = dynamic(() => import('@/components/agent/tabs/pods-tab').then(m => ({ default: m.PodsTab })), { loading: () => <TabLoader label="Loading pods…" /> })
const MissionActiveTab = dynamic(() => import('@/components/agent/tabs/mission-active-tab').then(m => ({ default: m.MissionActiveTab })), { loading: () => <TabLoader label="Loading active missions…" /> })
// UPGRADE VID — Venture Intelligence Division tab. The most powerful department after the CEO.
// Owns venture creation, scoring (Venture Score ≥ 87), portfolio management, and Knowledge Transfer Rate.
const VidTab = dynamic(() => import('@/components/agent/tabs/vid-tab').then(m => ({ default: m.VidTab })), { loading: () => <TabLoader label="Loading Venture Intelligence Division…" /> })
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

  // Initial load (only after we know the user is authenticated)
  // UPGRADE #90 FIX — MUST be declared BEFORE any early return to avoid
  // "React Hook order" violation which causes client-side exception:
  // "Application error: a client-side exception has occurred"
  //
  // DEBUG-SLOW-TABS fix: Removed the sequential `fetch('/api/health')` warm-up.
  // Before: fired /api/health FIRST, then in .finally() fired the 3 real loads.
  //   /api/health is a SEPARATE Lambda from /api/conversations — warming it does
  //   NOTHING for the other endpoints. This added a ~0.3s sequential delay before
  //   the real data fetches even started.
  // After: fire the 3 real loads immediately in parallel + pre-warm the Dashboard
  //   tab endpoints (income, settings, dashboard/widgets) in the background so
  //   they're warm when the user clicks the Dashboard tab.
  useEffect(() => {
    if (status !== 'authenticated') return
    // Fire the 3 primary loads in parallel immediately (no pre-warm gate).
    Promise.all([
      loadConversations(),
      loadMemories(),
      loadSubagentCount(),
    ]).catch(() => {/* swallow — each function already handles errors */})

    // DEBUG-SLOW-TABS fix: Pre-warm the Dashboard tab endpoints in the background.
    // These are DIFFERENT Lambdas from the 3 above and are NOT warmed by PreWarmDb.
    // Without this, the first Dashboard tab click hits 3-4 COLD Lambdas (3-5s each).
    // We fire them with `keepalive: true` so they survive page navigation.
    const dashEndpoints = [
      '/api/income?limit=1',
      '/api/settings',
      '/api/dashboard/widgets',
    ]
    dashEndpoints.forEach((path) => {
      fetch(path, { method: 'GET', keepalive: true, signal: AbortSignal.timeout(8000) })
        .catch(() => {/* silent — just warming */})
    })

    // Start the 30s auto-refresh loop (non-blocking)
    startAutoRefresh()
  }, [status, loadConversations, loadMemories, loadSubagentCount, startAutoRefresh])

  // UPGRADE #132 — Loading screen with progress indicator
  // Shows what's happening during cold starts instead of a blank page
  if (status === 'loading' || status === 'unauthenticated') {
    return (
      <div className="relative min-h-screen flex flex-col items-center justify-center bg-black overflow-hidden">
        <div className="relative z-10 flex flex-col items-center">
          <div className="hex-pulse mb-5">
            <NexusLogo size={72} />
          </div>
          <div className="flex items-center gap-2 text-cyan-300 text-sm tracking-[0.25em] font-semibold mb-4">
            <Loader2 className="w-4 h-4 animate-spin" />
            {status === 'unauthenticated' ? 'REDIRECTING TO LOGIN…' : 'BOOTING AGENT007…'}
          </div>
          {/* UPGRADE #132: Progress steps so user knows what's happening */}
          <div className="flex flex-col gap-1.5 text-[10px] text-[#5b6a92] tracking-wider">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
              <span>Initializing system…</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-cyan-400/40" />
              <span>Loading 6 LLM providers…</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-cyan-400/40" />
              <span>Connecting 20 subagents…</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-cyan-400/40" />
              <span>Preparing dashboard…</span>
            </div>
          </div>
          {/* Animated progress bar */}
          <div className="mt-5 w-48 h-1 bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-cyan-400 to-purple-500 rounded-full"
              style={{ animation: 'loadingBar 2s ease-in-out infinite' }}
            />
          </div>
        </div>
        <style jsx>{`
          @keyframes loadingBar {
            0% { width: 0%; transform: translateX(-100%); }
            50% { width: 60%; }
            100% { width: 100%; transform: translateX(100%); }
          }
        `}</style>
      </div>
    )
  }

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
            {activeTab === 'vid' && <VidTab />}
            {activeTab === 'pods' && <PodsTab />}
            {activeTab === 'mission-active' && <MissionActiveTab />}
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
