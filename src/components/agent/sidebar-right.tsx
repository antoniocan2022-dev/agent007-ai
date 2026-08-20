'use client'

import { useMemo, useState } from 'react'
import { MessageSquare } from 'lucide-react'
import { useChatStore } from '@/store/chat-store'

function messagePreview(content: string): string {
  const clean = content.replace(/\s+/g, ' ').trim()
  if (!clean) return 'Untitled message'
  return clean.length > 220 ? `${clean.slice(0, 220)}…` : clean
}

function markerWidth(content: string): number {
  const length = content.replace(/\s+/g, ' ').trim().length
  return Math.min(30, Math.max(9, Math.round(length / 7)))
}

/**
 * Static CEO conversation outline. The rail itself never participates in the
 * page/document scroll; only this narrow list may scroll when a conversation
 * has more messages than the viewport.
 *
 * Every rendered message receives a navigation marker. Clicking a marker uses
 * the message's stable DOM id, so it works for the beginning, middle, or end
 * of a conversation.
 */
export function SidebarRight() {
  const messages = useChatStore((s) => s.messages)
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null)

  const navigableMessages = useMemo(
    () => messages.filter((message) => message.content.trim()),
    [messages],
  )

  const scrollToMessage = (id: string) => {
    const target = document.getElementById(`chat-message-${id}`)
    if (!target) return

    setActiveMessageId(id)
    target.scrollIntoView({ behavior: 'smooth', block: 'center' })

    window.setTimeout(() => {
      setActiveMessageId((current) => (current === id ? null : current))
    }, 900)
  }

  return (
    <aside
      className="h-full w-10 sm:w-11 flex-shrink-0 border-l border-cyan-400/15 bg-black/20"
      aria-label="CEO conversation history"
    >
      <div className="h-full flex flex-col items-center">
        <div
          className="h-12 w-full flex items-center justify-center border-b border-cyan-400/10"
          title="Conversation history"
        >
          <MessageSquare className="w-3.5 h-3.5 text-cyan-300/80" aria-hidden="true" />
        </div>

        <div className="flex-1 min-h-0 w-full overflow-y-auto overflow-x-hidden overscroll-contain py-3 px-1 scroll-cyan">
          {navigableMessages.length === 0 ? (
            <div className="h-full flex items-center justify-center" title="No previous messages">
              <span className="w-2 h-2 rounded-full bg-cyan-400/25" aria-hidden="true" />
            </div>
          ) : (
            <div className="flex min-h-full flex-col items-center gap-1">
              {navigableMessages.map((message, index) => {
                const preview = messagePreview(message.content)
                const isUser = message.role === 'user'
                const isActive = activeMessageId === message.id

                return (
                  <div key={message.id} className="relative flex w-full justify-center group">
                    <button
                      type="button"
                      onClick={() => scrollToMessage(message.id)}
                      title={preview}
                      className="relative h-5 w-full flex items-center justify-center rounded-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-300/80"
                      aria-label={`Go to ${isUser ? 'user' : 'assistant'} message ${index + 1}: ${preview}`}
                    >
                      <span
                        className={`h-0.5 rounded-full transition-all duration-150 group-hover:h-1 group-hover:shadow-[0_0_8px_rgba(0,240,255,0.65)] ${
                          isActive
                            ? 'h-1 bg-cyan-200 shadow-[0_0_10px_rgba(0,240,255,0.9)]'
                            : isUser
                              ? 'bg-cyan-400/55 group-hover:bg-cyan-300'
                              : 'bg-purple-400/45 group-hover:bg-purple-300'
                        }`}
                        style={{ width: markerWidth(message.content) }}
                      />
                    </button>

                    <div
                      role="tooltip"
                      className="pointer-events-none invisible absolute right-full top-1/2 z-50 mr-2 w-80 -translate-y-1/2 rounded-lg border border-cyan-400/25 bg-[#07101d]/95 px-3 py-2 text-left opacity-0 shadow-[0_8px_30px_rgba(0,0,0,0.55)] backdrop-blur-md transition-all duration-150 group-hover:visible group-hover:opacity-100"
                    >
                      <div className="mb-1 text-[8px] font-semibold tracking-[0.18em] text-cyan-300/70">
                        {isUser ? 'USER' : 'AGENT007'} · MESSAGE {index + 1}
                      </div>
                      <div className="text-[11px] leading-4 text-[#d7e3f7] break-words">
                        {preview}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
