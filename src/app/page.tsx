'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useChatStore } from '@/store/chat-store'
import { Background } from '@/components/agent/background'
import { ChatHeader } from '@/components/agent/chat-header'
import { ChatThread } from '@/components/agent/chat-thread'
import { ChatInput } from '@/components/agent/chat-input'
import { SidebarLeft } from '@/components/agent/sidebar-left'
import { SidebarRight } from '@/components/agent/sidebar-right'

export default function Home() {
  const [leftOpenMobile, setLeftOpenMobile] = useState(false)
  const [rightOpenMobile, setRightOpenMobile] = useState(false)

  const leftOpen = useChatStore((s) => s.leftOpen)
  const rightOpen = useChatStore((s) => s.rightOpen)
  const toggleLeft = useChatStore((s) => s.toggleLeft)
  const toggleRight = useChatStore((s) => s.toggleRight)
  const loadConversations = useChatStore((s) => s.loadConversations)
  const loadMemories = useChatStore((s) => s.loadMemories)
  const conversations = useChatStore((s) => s.conversations)

  // Initial load
  useEffect(() => {
    loadConversations()
    loadMemories()
  }, [loadConversations, loadMemories])

  // If no conversation exists yet, create one on first mount (lazy: only when user sends first msg)
  // We don't auto-create to keep the empty state clean.

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
          <AnimatePresence initial={false}>
            {leftOpen && (
              <motion.aside
                key="left-desktop"
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 240, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: 'easeInOut' }}
                className="hidden md:block flex-shrink-0 overflow-hidden"
              >
                <div style={{ width: 240 }} className="h-full">
                  <SidebarLeft />
                </div>
              </motion.aside>
            )}
          </AnimatePresence>

          {/* Left sidebar - mobile drawer */}
          <AnimatePresence initial={false}>
            {leftOpenMobile && (
              <>
                <motion.div
                  key="left-mobile-overlay"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setLeftOpenMobile(false)}
                  className="md:hidden fixed inset-0 bg-black/70 backdrop-blur-sm z-40"
                />
                <motion.aside
                  key="left-mobile"
                  initial={{ x: -300 }}
                  animate={{ x: 0 }}
                  exit={{ x: -300 }}
                  transition={{ type: 'spring', damping: 25, stiffness: 220 }}
                  className="md:hidden fixed top-0 left-0 bottom-0 w-[260px] z-50"
                >
                  <SidebarLeft onClose={() => setLeftOpenMobile(false)} />
                </motion.aside>
              </>
            )}
          </AnimatePresence>

          {/* Center column */}
          <main className="flex-1 flex flex-col min-w-0 min-h-0">
            <ChatThread />
            <ChatInput />
          </main>

          {/* Right sidebar - desktop */}
          <AnimatePresence initial={false}>
            {rightOpen && (
              <motion.aside
                key="right-desktop"
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 300, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: 'easeInOut' }}
                className="hidden md:block flex-shrink-0 overflow-hidden"
              >
                <div style={{ width: 300 }} className="h-full">
                  <SidebarRight />
                </div>
              </motion.aside>
            )}
          </AnimatePresence>

          {/* Right sidebar - mobile drawer */}
          <AnimatePresence initial={false}>
            {rightOpenMobile && (
              <>
                <motion.div
                  key="right-mobile-overlay"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setRightOpenMobile(false)}
                  className="md:hidden fixed inset-0 bg-black/70 backdrop-blur-sm z-40"
                />
                <motion.aside
                  key="right-mobile"
                  initial={{ x: 320 }}
                  animate={{ x: 0 }}
                  exit={{ x: 320 }}
                  transition={{ type: 'spring', damping: 25, stiffness: 220 }}
                  className="md:hidden fixed top-0 right-0 bottom-0 w-[280px] z-50"
                >
                  <SidebarRight onClose={() => setRightOpenMobile(false)} />
                </motion.aside>
              </>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Hidden state-keeper so conversations load on mount even if unused */}
      <span className="hidden" aria-hidden>
        {conversations.length}
      </span>
    </div>
  )
}
