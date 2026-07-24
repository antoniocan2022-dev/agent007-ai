'use client'

import { useEffect, useRef, useState, useMemo } from 'react'
import { useChatStore } from '@/store/chat-store'
import { MessageBubble } from './message-bubble'
import { EmptyState } from './empty-state'
import { ScrollArrows } from './scroll-arrows' // UPGRADE #69 — scroll up/down arrows

// UPGRADE #125 — Rec 3A: Virtualize message list
// Only render messages that are near the viewport (±5 messages from current scroll position).
// This prevents the page from having hundreds of DOM nodes in long conversations.
const VISIBLE_BUFFER = 5  // render 5 messages above + below the viewport
const MAX_RENDER_MESSAGES = 15  // never render more than 15 at once

export function ChatThread() {
  const messages = useChatStore((s) => s.messages)
  const status = useChatStore((s) => s.status)
  const sendMessage = useChatStore((s) => s.sendMessage)
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(800)

  useEffect(() => {
    // UPGRADE #125 — Rec 2B: Use 'auto' instead of 'smooth' to avoid layout thrashing
    const el = bottomRef.current
    if (el) {
      el.scrollIntoView({ behavior: 'auto', block: 'end' })
    }
  }, [messages])

  // Track scroll position for virtualization
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
    setViewportHeight(e.currentTarget.clientHeight)
  }

  // UPGRADE #125 — Rec 3A: Calculate which messages to render
  // Estimate message height as ~120px (conservative average)
  const ESTIMATED_MSG_HEIGHT = 120
  const visibleStart = Math.max(0, Math.floor(scrollTop / ESTIMATED_MSG_HEIGHT) - VISIBLE_BUFFER)
  const visibleEnd = Math.min(
    messages.length,
    visibleStart + Math.ceil(viewportHeight / ESTIMATED_MSG_HEIGHT) + VISIBLE_BUFFER * 2
  )

  // Always render the last few messages (so streaming content is visible)
  const renderStart = Math.min(visibleStart, Math.max(0, messages.length - MAX_RENDER_MESSAGES))
  const renderEnd = Math.min(Math.max(visibleEnd, messages.length), renderStart + MAX_RENDER_MESSAGES)

  const visibleMessages = useMemo(
    () => messages.slice(renderStart, renderEnd),
    [messages, renderStart, renderEnd]
  )

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
    <div className="flex-1 relative min-h-0">
      <div
        ref={containerRef}
        className="h-full overflow-y-auto scroll-cyan"
        role="log"
        aria-live="polite"
        aria-busy={status !== 'idle'}
        onScroll={handleScroll}
      >
        <div className="max-w-[820px] mx-auto px-4 sm:px-6 py-6">
          {/* Spacer for virtualized messages above the viewport */}
          {renderStart > 0 && (
            <div style={{ height: renderStart * ESTIMATED_MSG_HEIGHT }} className="flex-shrink-0" />
          )}
          {visibleMessages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
          {/* Spacer for virtualized messages below the viewport */}
          {renderEnd < messages.length && (
            <div style={{ height: (messages.length - renderEnd) * ESTIMATED_MSG_HEIGHT }} className="flex-shrink-0" />
          )}
          <div ref={bottomRef} className="h-2" />
        </div>
      </div>
      {/* UPGRADE #69 — Scroll arrows (up = top, down = bottom) */}
      <ScrollArrows containerRef={containerRef} />
    </div>
  )
}
