'use client'

import { useEffect, useRef } from 'react'
import { useChatStore } from '@/store/chat-store'
import { MessageBubble } from './message-bubble'
import { EmptyState } from './empty-state'
import { ScrollArrows } from './scroll-arrows' // UPGRADE #69 — scroll up/down arrows

export function ChatThread() {
  const messages = useChatStore((s) => s.messages)
  const status = useChatStore((s) => s.status)
  const sendMessage = useChatStore((s) => s.sendMessage)
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Auto-scroll to bottom on new content
    const el = bottomRef.current
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [messages])

  if (messages.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto scroll-cyan">
        <EmptyState
          onPick={(text) => {
            sendMessage(text)
          }}
        />
      </div>
    )
  }

  return (
    <div className="flex-1 relative min-h-0"> {/* UPGRADE #69 — relative for ScrollArrows positioning */}
      <div
        ref={containerRef}
        className="h-full overflow-y-auto scroll-cyan"
        role="log"
        aria-live="polite"
        aria-busy={status !== 'idle'}
      >
        <div className="max-w-[820px] mx-auto px-4 sm:px-6 py-6">
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
          <div ref={bottomRef} className="h-2" />
        </div>
      </div>
      {/* UPGRADE #69 — Scroll arrows (up = top, down = bottom) */}
      <ScrollArrows containerRef={containerRef} />
    </div>
  )
}
