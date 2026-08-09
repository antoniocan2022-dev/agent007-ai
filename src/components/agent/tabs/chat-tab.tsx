'use client'

import { useLayoutEffect } from 'react'
import { ChatThread } from '@/components/agent/chat-thread'
import { ChatInput } from '@/components/agent/chat-input'
import { RateLimitBanner } from '@/components/agent/rate-limit-banner'
import { useChatStore } from '@/store/chat-store'

export function ChatTab() {
  const setLeft = useChatStore((s) => s.setLeft)
  const setRight = useChatStore((s) => s.setRight)

  // CEO chat opens as a clean canvas. Users can reveal either panel from the
  // header; this keeps the first impression focused on the conversation.
  useLayoutEffect(() => {
    setLeft(false)
    setRight(false)
  }, [setLeft, setRight])

  return (
    <main className="flex-1 flex flex-col min-w-0 min-h-0">
      <ChatThread />
      <div className="sticky bottom-0 z-30">
        <RateLimitBanner />
        <ChatInput />
      </div>
    </main>
  )
}
