'use client'

import { ChatThread } from '@/components/agent/chat-thread'
import { ChatInput } from '@/components/agent/chat-input'

export function ChatTab() {
  return (
    <main className="flex-1 flex flex-col min-w-0 min-h-0">
      <ChatThread />
      <ChatInput />
    </main>
  )
}
