'use client'

import { ChatThread } from '@/components/agent/chat-thread'
import { ChatInput } from '@/components/agent/chat-input'
import { RateLimitBanner } from '@/components/agent/rate-limit-banner'

export function ChatTab() {
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
