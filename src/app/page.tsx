'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { useChatStore } from '@/store/chat-store'
import { Background } from '@/components/agent/background'
import { ChatHeader } from '@/components/agent/chat-header'
import { AgentProgressBanner } from '@/components/agent/agent-progress-banner'
import { SidebarLeft } from '@/components/agent/sidebar-left'
import { SidebarRight } from '@/components/agent/sidebar-right'
import { NexusLogo } from '@/components/agent/nexus-logo'
import { ChatTab } from '@/components/agent/tabs/chat-tab'
import dynamic from 'next/dynamic'

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
const VidTab = dynamic(() => import('@/components/agent/tabs/vid-tab').then(m => ({ default: m.VidTab })), { loading: () => <TabLoader label="Loading Venture Intelligence Division…" /> })
import { ChangePasswordModal } from '@/components/agent/change-password-modal'
import { PwaInstallPrompt } from '@/components/agent/pwa-install-prompt'
import { AnimatePresence } from 'framer-motion'
import { motion as Motion } from 'framer-motion'

interface BootFacts {
  organization?: { leaderCount?: number; specialistCount?: number }
  providers?: { registeredCount?: number }
}

export default function Home() {
  const { status } = useSession()
  const router = useRouter()
  const [leftOpenMobile, setLeftOpenMobile] = useState(false)
  const [bootFacts, setBootFacts] = useState<BootFacts>({})

  const leftOpen = useChatStore((s) => s.leftOpen)
  const toggleLeft = useChatStore((s) => s.toggleLeft)
  const loadConversations = useChatStore((s) => s.loadConversations)
  const loadMemories = useChatStore((s) => s.loadMemories)
  const loadSubagentCount = useChatStore((s) => s.loadSubagentCount)
  const conversations = useChatStore((s) => s.conversations)
  const activeTab = useChatStore((s) => s.activeTab)
  const startAutoRefresh = useChatStore((s) => s.startAutoRefresh)

  useEffect(() => {
    fetch('/api/system/canonical-facts', { method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(5000) })
      .then((response) => response.ok ? response.json() : null)
      .then((facts) => facts && setBootFacts(facts))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (status === 'unauthenticated') {
      if (typeof window !== 'undefined') window.location.replace('/login')
      else router.replace('/login')
    }
  }, [status, router])

  useEffect(() => {
    if (status !== 'authenticated') return
    Promise.all([loadConversations(), loadMemories(), loadSubagentCount()]).catch(() => {})

    const dashEndpoints = ['/api/income?limit=1', '/api/settings', '/api/dashboard/widgets']
    dashEndpoints.forEach((path) => {
      fetch(path, { method: 'GET', keepalive: true, signal: AbortSignal.timeout(8000) }).catch(() => {})
    })

    startAutoRefresh()
  }, [status, loadConversations, loadMemories, loadSubagentCount, startAutoRefresh])

  if (status === 'loading' || status === 'unauthenticated') {
    const providerCount = bootFacts.providers?.registeredCount
    const leaderCount = bootFacts.organization?.leaderCount
    const specialistCount = bootFacts.organization?.specialistCount
    return (
      <div className="relative min-h-screen flex flex-col items-center justify-center bg-black overflow-hidden">
        <div className="relative z-10 flex flex-col items-center">
          <div className="hex-pulse mb-5"><NexusLogo size={72} /></div>
          <div className="flex items-center gap-2 text-cyan-300 text-sm tracking-[0.25em] font-semibold mb-4">
            <Loader2 className="w-4 h-4 animate-spin" />
            {status === 'unauthenticated' ? 'REDIRECTING TO LOGIN…' : 'BOOTING AGENT007…'}
          </div>
          <div className="flex flex-col gap-1.5 text-[10px] text-[#5b6a92] tracking-wider">
            <div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" /><span>Initializing system…</span></div>
            <div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-cyan-400/40" /><span>Loading {providerCount ?? '…'} LLM providers…</span></div>
            <div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-cyan-400/40" /><span>Connecting {leaderCount ?? '…'} leaders / {specialistCount ?? '…'} specialists…</span></div>
            <div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-cyan-400/40" /><span>Preparing dashboard…</span></div>
          </div>
          <div className="mt-5 w-48 h-1 bg-white/5 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-cyan-400 to-purple-500 rounded-full" style={{ animation: 'loadingBar 2s ease-in-out infinite' }} />
          </div>
        </div>
        <style jsx>{`@keyframes loadingBar { 0% { width: 0%; transform: translateX(-100%); } 50% { width: 60%; } 100% { width: 100%; transform: translateX(100%); } }`}</style>
      </div>
    )
  }

  return (
    <div className="relative h-dvh overflow-hidden flex flex-col bg-black">
      <Background />

      <div className="relative z-10 flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="flex-shrink-0">
          <ChatHeader
            onToggleLeft={() => {
              if (typeof window !== 'undefined' && window.innerWidth < 768) setLeftOpenMobile((v) => !v)
              else toggleLeft()
            }}
          />
        </div>

        <div className="flex-1 min-h-0 flex relative overflow-hidden">
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

          <main className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
            <AgentProgressBanner />
            {activeTab === 'chat' && <ChatTab />}
            {activeTab === 'missions' && <MissionsTab />}
            {activeTab === 'vid' && <VidTab />}
            {activeTab === 'pods' && <PodsTab />}
            {activeTab === 'mission-active' && <MissionActiveTab />}
            {activeTab === 'dashboard' && <DashboardTab />}
            {activeTab === 'schedules' && <SchedulesTab />}
            {activeTab === 'settings' && (
              <SettingsTab onOpenChangePassword={() => useChatStore.getState().setChangePasswordOpen(true)} />
            )}
          </main>

          <div className="hidden md:block h-full flex-shrink-0 w-10 sm:w-11 overflow-hidden">
            <SidebarRight />
          </div>
        </div>
      </div>

      <ChangePasswordModal />
      <PwaInstallPrompt />

      <span className="hidden" aria-hidden>{conversations.length}</span>
    </div>
  )
}

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
      <AnimatePresence initial={false}>
        {show && desktopWidth > 0 && (
          <Motion.aside
            key={desktopKey}
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: desktopWidth, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className={`h-full flex-shrink-0 overflow-hidden ${desktopClassName ?? 'hidden md:block'}`}
          >
            <div style={{ width: desktopWidth }} className="h-full">
              {renderContent()}
            </div>
          </Motion.aside>
        )}
      </AnimatePresence>

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
