'use client'

import { useEffect, useRef } from 'react'
import { useChatStore } from '@/store/chat-store'
import { MessageBubble } from './message-bubble'
import { EmptyState } from './empty-state'
import { ScrollArrows } from './scroll-arrows'

/**
 * The chat viewport owns vertical scrolling. The shell intentionally never
 * scrolls, which keeps both history rails anchored while this content moves.
 * Every loaded message stays mounted so the history rail can jump to any
 * message, including the first one in a long conversation.
 */
export function ChatThread() {
  const messages = useChatStore((s) => s.messages)
  const status = useChatStore((s) => s.status)
  const sendMessage = useChatStore((s) => s.sendMessage)
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const prevMsgCount = useRef(0)

  useEffect(() => {
    if (messages.length > prevMsgCount.current) {
      const el = bottomRef.current
      if (el) el.scrollIntoView({ behavior: 'auto', block: 'end' })
    }
    prevMsgCount.current = messages.length
  }, [messages])

  if (messages.length === 0) {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto scroll-cyan">
        <EmptyState onPick={(text) => { sendMessage(text) }} />
      </div>
    )
  }

  return (
    <div className="flex-1 relative min-h-0 overflow-hidden">
      <div
        ref={containerRef}
        data-chat-scroll-container="true"
        className="h-full overflow-y-auto overflow-x-hidden scroll-cyan overscroll-contain"
        role="log"
        aria-live="polite"
        aria-busy={status !== 'idle'}
      >
        <div className="max-w-[820px] mx-auto px-4 sm:px-6 py-6">
          {messages.map((m) => (
            <div
              key={m.id}
              id={`chat-message-${m.id}`}
              data-chat-message-id={m.id}
              className="scroll-mt-24"
              style={{ contentVisibility: 'auto', containIntrinsicSize: '120px' }}
            >
              <MessageBubble message={m} />
            </div>
          ))}
          <div ref={bottomRef} className="h-2" />
        </div>
      </div>
      <ScrollArrows containerRef={containerRef} />
    </div>
  )
}
