'use client'

import { useEffect, useRef } from 'react'
import { useChatStore } from '@/store/chat-store'
import { MessageBubble } from './message-bubble'
import { EmptyState } from './empty-state'
import { ScrollArrows } from './scroll-arrows'

// UPGRADE #131: Removed broken virtualization (was causing blank messages + scroll jumps)
// Instead: cap at last 50 messages (enough for any conversation, no perf issues with memo)
const MAX_MESSAGES = 50

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
      <div className="flex-1 overflow-y-auto scroll-cyan">
        <EmptyState onPick={(text) => { sendMessage(text) }} />
      </div>
    )
  }

  const displayMessages = messages.length > MAX_MESSAGES ? messages.slice(-MAX_MESSAGES) : messages

  return (
    <div className="flex-1 relative min-h-0">
      <div ref={containerRef} className="h-full overflow-y-auto scroll-cyan" role="log" aria-live="polite" aria-busy={status !== 'idle'}>
        <div className="max-w-[820px] mx-auto px-4 sm:px-6 py-6">
          {displayMessages.map((m) => (
            <div key={m.id} id={`chat-message-${m.id}`} className="scroll-mt-24">
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
