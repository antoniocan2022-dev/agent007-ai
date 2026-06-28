'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { Plus, MessageSquare, Trash2, X, Settings } from 'lucide-react'
import { useChatStore } from '@/store/chat-store'
import { NexusLogo } from './nexus-logo'

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`
  return `${Math.round(diff / 86_400_000)}d ago`
}

export function SidebarLeft({ onClose }: { onClose?: () => void }) {
  const conversations = useChatStore((s) => s.conversations)
  const currentId = useChatStore((s) => s.currentConversationId)
  const selectConversation = useChatStore((s) => s.selectConversation)
  const createConversation = useChatStore((s) => s.createConversation)
  const deleteConversation = useChatStore((s) => s.deleteConversation)

  const handleNew = async () => {
    await createConversation()
    onClose?.()
  }
  const handleSelect = async (id: string) => {
    await selectConversation(id)
    onClose?.()
  }

  return (
    <div className="h-full flex flex-col glass-strong border-r border-cyan-400/15">
      {/* header */}
      <div className="p-3 flex items-center justify-between border-b border-cyan-400/10">
        <div className="flex items-center gap-2">
          <NexusLogo size={24} />
          <div className="leading-tight">
            <div className="text-sm font-bold neon-text-cyan">NEXUS</div>
            <div className="text-[8px] tracking-[0.25em] text-[#7c89b5]">SUPER AGENT</div>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="md:hidden text-[#7c89b5] hover:text-cyan-300"
            aria-label="Close sidebar"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* new chat */}
      <div className="p-2.5">
        <button
          onClick={handleNew}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg neon-btn-cyan text-xs font-semibold tracking-wide"
        >
          <Plus className="w-4 h-4" /> NEW CHAT
        </button>
      </div>

      {/* conversation list */}
      <div className="flex-1 overflow-y-auto scroll-cyan px-2 pb-2">
        <div className="text-[9px] tracking-[0.2em] text-[#5b6a92] px-2 py-2">HISTORY</div>
        {conversations.length === 0 ? (
          <div className="text-[11px] text-[#5b6a92] px-2 py-4 text-center">
            No conversations yet.
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {conversations.map((c) => {
              const active = c.id === currentId
              return (
                <motion.div
                  key={c.id}
                  layout
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  className={`group relative mb-1 rounded-lg px-2.5 py-2 cursor-pointer transition ${
                    active
                      ? 'bg-cyan-400/10 border border-cyan-400/40 shadow-[0_0_12px_rgba(0,240,255,0.18)]'
                      : 'hover:bg-white/5 border border-transparent'
                  }`}
                  onClick={() => handleSelect(c.id)}
                >
                  <div className="flex items-start gap-2">
                    <MessageSquare
                      className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${
                        active ? 'text-cyan-300' : 'text-[#5b6a92]'
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <div
                        className={`text-xs truncate ${
                          active ? 'text-[#e0e7ff] font-medium' : 'text-[#9bb5d4]'
                        }`}
                      >
                        {c.title || 'New Conversation'}
                      </div>
                      <div className="text-[9px] text-[#5b6a92] mt-0.5">
                        {relativeTime(c.updatedAt)}
                        {c._count?.messages ? ` • ${c._count.messages} msgs` : ''}
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        if (confirm('Delete this conversation?')) deleteConversation(c.id)
                      }}
                      className="opacity-0 group-hover:opacity-100 text-[#5b6a92] hover:text-pink-300 transition flex-shrink-0"
                      aria-label="Delete conversation"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>
        )}
      </div>

      {/* footer */}
      <div className="p-3 border-t border-cyan-400/10">
        <div className="flex items-center gap-2 text-[10px] text-[#5b6a92]">
          <Settings className="w-3 h-3" />
          <span>v1.0 • powered by Z.ai SDK</span>
        </div>
      </div>
    </div>
  )
}
