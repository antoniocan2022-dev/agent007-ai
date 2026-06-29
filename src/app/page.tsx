'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Loader2 } from 'lucide-react'
import { useChatStore } from '@/store/chat-store'
import { Background } from '@/components/agent/background'
import { ChatHeader } from '@/components/agent/chat-header'
import { ChatThread } from '@/components/agent/chat-thread'
import { ChatInput } from '@/components/agent/chat-input'
import { SidebarLeft } from '@/components/agent/sidebar-left'
import { SidebarRight } from '@/components/agent/sidebar-right'
import { NexusLogo } from '@/components/agent/nexus-logo'

export default function Home() {
  const { status } = useSession()
  const router = useRouter()
  const [leftOpenMobile, setLeftOpenMobile] = useState(false)
  const [rightOpenMobile, setRightOpenMobile] = useState(false)

  const leftOpen = useChatStore((s) => s.leftOpen)
  const rightOpen = useChatStore((s) => s.rightOpen)
  const toggleLeft = useChatStore((s) => s.toggleLeft)
  const toggleRight = useChatStore((s) => s.toggleRight)
  const loadConversations = useChatStore((s) => s.loadConversations)
  const loadMemories = useChatStore((s) => s.loadMemories)
  const conversations = useChatStore((s) => s.conversations)

  // Redirect to /login when unauthenticated.
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login')
    }
  }, [status, router])

  // Initial load (only after we know the user is authenticated)
  useEffect(() => {
    if (status !== 'authenticated') return
    loadConversations()
    loadMemories()
  }, [status, loadConversations, loadMemories])

  if (status === 'loading' || status === 'unauthenticated') {
    return (
      <div className="relative min-h-screen flex flex-col items-center justify-center bg-black overflow-hidden">
        <Background />
        <motion.div
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="relative z-10 flex flex-col items-center"
        >
          <div className="hex-pulse mb-5">
            <NexusLogo size={72} />
          </div>
          <div className="flex items-center gap-2 text-cyan-300 text-sm tracking-[0.25em] font-semibold">
            <Loader2 className="w-4 h-4 animate-spin" />
            {status === 'unauthenticated' ? 'REDIRECTING…' : 'BOOTING AGENT007…'}
          </div>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="relative min-h-screen flex flex-col bg-black">
      <Background />

      <div className="relative z-10 flex-1 flex flex-col min-h-0">
        <ChatHeader
          onToggleLeft={() => {
            if (window.innerWidth < 768) setLeftOpenMobile((v) => !v)
            else toggleLeft()
          }}
          onToggleRight={() => {
            if (window.innerWidth < 768) setRightOpenMobile((v) => !v)
            else toggleRight()
          }}
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

          {/* Center column */}
          <main className="flex-1 flex flex-col min-w-0 min-h-0">
            <ChatThread />
            <ChatInput />
          </main>

          {/* Right sidebar */}
          <AnimatePresenceHelper
            show={rightOpen}
            desktopKey="right-desktop"
            mobileKey="right-mobile"
            mobileOpen={rightOpenMobile}
            onMobileClose={() => setRightOpenMobile(false)}
            mobileWidth={280}
            desktopWidth={300}
            side="right"
            renderContent={() => <SidebarRight />}
            renderMobileContent={(onClose) => <SidebarRight onClose={onClose} />}
          />
        </div>
      </div>

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
}) {
  return (
    <>
      {/* Desktop */}
      <AnimatePresence initial={false}>
        {show && (
          <Motion.aside
            key={desktopKey}
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: desktopWidth, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="hidden md:block flex-shrink-0 overflow-hidden"
          >
            <div style={{ width: desktopWidth }} className="h-full">
              {renderContent()}
            </div>
          </Motion.aside>
        )}
      </AnimatePresence>

      {/* Mobile drawer */}
      <AnimatePresence initial={false}>
        {mobileOpen && (
          <>
            <Motion.div
              key={`${mobileKey}-overlay`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onMobileClose}
              className="md:hidden fixed inset-0 bg-black/70 backdrop-blur-sm z-40"
            />
            <Motion.aside
              key={mobileKey}
              initial={{ x: side === 'left' ? -300 : 320 }}
              animate={{ x: 0 }}
              exit={{ x: side === 'left' ? -300 : 320 }}
              transition={{ type: 'spring', damping: 25, stiffness: 220 }}
              className={`md:hidden fixed top-0 bottom-0 z-50 ${side === 'left' ? 'left-0' : 'right-0'}`}
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
