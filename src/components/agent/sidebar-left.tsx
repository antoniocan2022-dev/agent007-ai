'use client'

import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, MessageSquare, Trash2, X, Settings, Download, ChevronDown, ChevronRight } from 'lucide-react'
import { useChatStore } from '@/store/chat-store'
import { NexusLogo } from './nexus-logo'

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`
  return `${Math.round(diff / 86_400_000)}d ago`
}

/**
 * UPGRADE #201: Group conversations by time period.
 * Groups: Today, Yesterday, This Week, Last Week, This Month, Last Month, Older
 */
function getTimeGroup(iso: string): string {
  const now = new Date()
  const date = new Date(iso)
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterdayStart = new Date(todayStart.getTime() - 86_400_000)
  const dayOfWeek = now.getDay() // 0=Sun, 6=Sat
  const thisWeekStart = new Date(todayStart.getTime() - dayOfWeek * 86_400_000)
  const lastWeekStart = new Date(thisWeekStart.getTime() - 7 * 86_400_000)
  const lastWeekEnd = new Date(thisWeekStart.getTime() - 1)
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const lastMonthEnd = new Date(thisMonthStart.getTime() - 1)

  if (date >= todayStart) return 'Today'
  if (date >= yesterdayStart) return 'Yesterday'
  if (date >= thisWeekStart) return 'This Week'
  if (date >= lastWeekStart && date <= lastWeekEnd) return 'Last Week'
  if (date >= thisMonthStart) return 'This Month'
  if (date >= lastMonthStart && date <= lastMonthEnd) return 'Last Month'
  return 'Older'
}

const GROUP_ORDER = ['Today', 'Yesterday', 'This Week', 'Last Week', 'This Month', 'Last Month', 'Older']

export function SidebarLeft({ onClose }: { onClose?: () => void }) {
  const conversations = useChatStore((s) => s.conversations)
  const currentId = useChatStore((s) => s.currentConversationId)
  const selectConversation = useChatStore((s) => s.selectConversation)
  const createConversation = useChatStore((s) => s.createConversation)
  const deleteConversation = useChatStore((s) => s.deleteConversation)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  // UPGRADE #202: Collapsible dropdown for each time group.
  // Today + Yesterday expanded by default; older groups collapsed (saves space).
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({
    Today: false,
    Yesterday: false,
    'This Week': true,
    'Last Week': true,
    'This Month': true,
    'Last Month': true,
    Older: true,
  })
  const toggleGroup = (group: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [group]: !prev[group] }))
  }

  const handleNew = async () => {
    await createConversation()
    onClose?.()
  }
  const handleSelect = async (id: string) => {
    await selectConversation(id)
    onClose?.()
  }
  const handleDelete = async (id: string) => {
    await deleteConversation(id)
    setConfirmDeleteId(null)
  }

  // Group conversations by time period
  const grouped = useMemo(() => {
    const map: Record<string, typeof conversations> = {}
    for (const c of conversations) {
      const group = getTimeGroup(c.updatedAt)
      if (!map[group]) map[group] = []
      map[group].push(c)
    }
    // Return as ordered array of [group, convs] pairs
    return GROUP_ORDER
      .filter((g) => map[g] && map[g].length > 0)
      .map((g) => [g, map[g]] as const)
  }, [conversations])

  return (
    <div className="h-full flex flex-col glass-strong border-r border-cyan-400/15">
      {/* header */}
      <div className="p-3 flex items-center justify-between border-b border-cyan-400/10">
        <div className="flex items-center gap-2">
          <NexusLogo size={24} />
          <div className="leading-tight">
            <div className="text-sm font-bold neon-text-cyan">Agent007</div>
            <div className="text-[8px] tracking-[0.25em] text-[#7c89b5]">INCOME OPERATOR</div>
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

      {/* conversation list — grouped by time period */}
      <div className="flex-1 overflow-y-auto scroll-cyan px-2 pb-2">
        {conversations.length === 0 ? (
          <div className="text-[11px] text-[#5b6a92] px-2 py-4 text-center">
            No conversations yet.
          </div>
        ) : (
          grouped.map(([groupLabel, convs]) => {
            const isCollapsed = collapsedGroups[groupLabel] ?? false
            return (
            <div key={groupLabel}>
              <button
                onClick={() => toggleGroup(groupLabel)}
                className="w-full flex items-center gap-1.5 text-[9px] tracking-[0.2em] text-[#5b6a92] px-2 py-2 pt-3 font-semibold uppercase hover:text-cyan-300 transition"
              >
                {isCollapsed ? (
                  <ChevronRight className="w-3 h-3 flex-shrink-0" />
                ) : (
                  <ChevronDown className="w-3 h-3 flex-shrink-0" />
                )}
                <span>{groupLabel}</span>
                <span className="text-[8px] text-[#3f4a6b] normal-case tracking-normal ml-auto">
                  {convs.length}
                </span>
              </button>
              <AnimatePresence initial={false}>
                {!isCollapsed && convs.map((c) => {
                  const active = c.id === currentId
                  const isConfirming = confirmDeleteId === c.id
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
                      } ${isConfirming ? 'bg-red-500/10 border border-red-400/40' : ''}`}
                      onClick={() => !isConfirming && handleSelect(c.id)}
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

                        {/* Action buttons — show on hover */}
                        {!isConfirming && (
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                window.open(`/api/conversations/${c.id}/export?format=markdown`, '_blank')
                              }}
                              className="opacity-0 group-hover:opacity-100 text-[#5b6a92] hover:text-cyan-300 transition"
                              aria-label="Export conversation"
                              title="Export as Markdown"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                setConfirmDeleteId(c.id)
                              }}
                              className="opacity-0 group-hover:opacity-100 text-[#5b6a92] hover:text-red-400 transition"
                              aria-label="Delete conversation"
                              title="Delete conversation"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}

                        {/* Delete confirmation */}
                        {isConfirming && (
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleDelete(c.id)
                              }}
                              className="text-[10px] px-2 py-1 rounded bg-red-500/20 text-red-300 hover:bg-red-500/30 border border-red-400/40 font-semibold"
                            >
                              Delete
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                setConfirmDeleteId(null)
                              }}
                              className="text-[10px] px-2 py-1 rounded text-[#7c89b5] hover:text-[#9bb5d4]"
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )
                })}
              </AnimatePresence>
            </div>
            )
          })
        )}
      </div>

      {/* footer */}
      <div className="p-3 border-t border-cyan-400/10">
        <div className="flex items-center gap-2 text-[10px] text-[#5b6a92]">
          <Settings className="w-3 h-3" />
          <span>v2.0 • powered by Z.ai SDK</span>
        </div>
      </div>
    </div>
  )
}
