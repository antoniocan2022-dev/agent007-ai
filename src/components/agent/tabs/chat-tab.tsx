'use client'

import { ChatThread } from '@/components/agent/chat-thread'
import { ChatInput } from '@/components/agent/chat-input'
import { RateLimitBanner } from '@/components/agent/rate-limit-banner'

/**
 * Chat remains inside the fixed application shell. Both history rails are
 * controlled by the shell rather than being toggled as a side effect of
 * mounting the chat tab, so changing tabs cannot unexpectedly move the layout.
 */
export function ChatTab() {
  return (
    <main className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
      <ChatThread />
      <div className="flex-shrink-0 z-30">
        <RateLimitBanner />
        <ChatInput />
      </div>
    </main>
  )
}
