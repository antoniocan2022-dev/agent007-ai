'use client'

import { useMemo } from 'react'
import { X, List, MessageSquare } from 'lucide-react'
import { useChatStore } from '@/store/chat-store'

function messageTitle(content: string): string {
  const clean = content.replace(/\s+/g, ' ').trim()
  if (!clean) return 'Untitled message'
  return clean.length > 72 ? `${clean.slice(0, 72)}…` : clean
}

export function SidebarRight({ onClose }: { onClose?: () => void }) {
  const messages = useChatStore((s) => s.messages)
  const currentConversationId = useChatStore((s) => s.currentConversationId)

  const userMessages = useMemo(
    () => messages.filter((m) => m.role === 'user' && m.content.trim()),
    [messages]
  )

  const scrollToMessage = (id: string) => {
    const target = document.getElementById(`chat-message-${id}`)
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  return (
    <div className="h-full flex flex-col glass-strong border-l border-cyan-400/15">
      <div className="h-12 px-3 flex items-center justify-between border-b border-cyan-400/10">
        <div className="flex items-center gap-2 min-w-0">
          <List className="w-4 h-4 text-cyan-300 flex-shrink-0" />
          <div className="min-w-0">
            <div className="text-xs font-semibold tracking-wider text-[#e0e7ff]">IN THIS CONVERSATION</div>
            <div className="text-[9px] text-[#5b6a92] truncate">{currentConversationId ? `${userMessages.length} messages` : 'Current chat'}</div>
          </div>
        </div>
        {onClose && <button onClick={onClose} className="md:hidden text-[#7c89b5] hover:text-cyan-300" aria-label="Close conversation outline"><X className="w-4 h-4" /></button>}
      </div>

      <div className="flex-1 overflow-y-auto scroll-cyan p-2">
        {userMessages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-4">
            <MessageSquare className="w-5 h-5 text-[#3f4a6b] mb-2" />
            <p className="text-[10px] text-[#5b6a92]">Your previous messages in this conversation will appear here.</p>
          </div>
        ) : (
          <div className="space-y-1">
            {userMessages.map((message, index) => (
              <button
                key={message.id}
                onClick={() => scrollToMessage(message.id)}
                className="w-full text-left rounded-lg px-2.5 py-2.5 border border-transparent hover:border-cyan-400/20 hover:bg-cyan-400/5 transition group"
                title={message.content}
              >
                <div className="flex items-start gap-2">
                  <span className="text-[9px] text-[#3f4a6b] mt-0.5 tabular-nums w-4 flex-shrink-0">{index + 1}</span>
                  <span className="text-[11px] leading-4 text-[#9bb5d4] group-hover:text-[#e0e7ff] line-clamp-3">{messageTitle(message.content)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
