'use client'

import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  Search,
  Link2,
  Palette,
  Eye,
  Terminal,
  Database,
  Brain,
  FileText,
  Cpu,
  Activity,
  Zap,
} from 'lucide-react'
import { useChatStore } from '@/store/chat-store'

const CAPABILITIES = [
  { icon: Search, label: 'Web Search', desc: 'Live web results' },
  { icon: Link2, label: 'Page Reader', desc: 'Read full pages' },
  { icon: Palette, label: 'Image Gen', desc: '768p–1440p output' },
  { icon: Eye, label: 'Vision', desc: 'Analyze images' },
  { icon: Terminal, label: 'Code Exec', desc: 'Sandboxed JS' },
  { icon: FileText, label: 'File Read', desc: 'Read uploads' },
  { icon: Database, label: 'Memory Store', desc: 'Persistent facts' },
  { icon: Brain, label: 'Memory Recall', desc: 'Context retrieval' },
]

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'idle'
      ? 'bg-emerald-400'
      : status === 'thinking'
      ? 'bg-purple-400'
      : status === 'tool_running'
      ? 'bg-cyan-400'
      : 'bg-cyan-300'
  return (
    <span className="relative flex h-2 w-2">
      {status !== 'idle' && (
        <span
          className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${color} animate-ping`}
        />
      )}
      <span className={`relative inline-flex rounded-full h-2 w-2 ${color}`} />
    </span>
  )
}

export function SidebarRight({ onClose }: { onClose?: () => void }) {
  const status = useChatStore((s) => s.status)
  const currentTool = useChatStore((s) => s.currentTool)
  const memories = useChatStore((s) => s.memories)

  const statusLabel =
    status === 'idle'
      ? 'IDLE'
      : status === 'thinking'
      ? 'THINKING'
      : status === 'tool_running'
      ? `RUNNING: ${currentTool ?? ''}`
      : 'STREAMING'

  return (
    <div className="h-full flex flex-col glass-strong border-l border-cyan-400/15">
      {/* header */}
      <div className="p-3 flex items-center justify-between border-b border-cyan-400/10">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyan-300" />
          <span className="text-xs font-semibold tracking-wider text-[#e0e7ff]">
            AGENT TELEMETRY
          </span>
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

      <div className="flex-1 overflow-y-auto scroll-cyan p-3 space-y-4">
        {/* agent status */}
        <section>
          <div className="text-[9px] tracking-[0.2em] text-[#5b6a92] mb-2">AGENT STATUS</div>
          <div className="glass rounded-lg p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <StatusDot status={status} />
                <span className="text-xs font-medium text-[#e0e7ff]">{statusLabel}</span>
              </div>
              <Cpu className="w-3.5 h-3.5 text-[#5b6a92]" />
            </div>
            {status !== 'idle' && (
              <div className="mt-2 flex items-center gap-1 text-[10px] text-[#9bb5d4]">
                <Zap className="w-3 h-3 text-cyan-300" />
                <span>Agent loop active — streaming events…</span>
              </div>
            )}
          </div>
        </section>

        {/* capabilities */}
        <section>
          <div className="text-[9px] tracking-[0.2em] text-[#5b6a92] mb-2">CAPABILITIES</div>
          <div className="grid grid-cols-2 gap-1.5">
            {CAPABILITIES.map((c) => {
              const Icon = c.icon
              const isActive = currentTool && c.label.toLowerCase().replace(' ', '_').includes(currentTool.toLowerCase().replace(' ', '_').split('_')[0])
              return (
                <div
                  key={c.label}
                  className={`rounded-md p-2 border ${
                    isActive
                      ? 'bg-cyan-400/10 border-cyan-400/50 shadow-[0_0_10px_rgba(0,240,255,0.2)]'
                      : 'glass border-cyan-400/15'
                  } transition`}
                >
                  <Icon className={`w-3.5 h-3.5 mb-1 ${isActive ? 'text-cyan-300' : 'text-[#9bb5d4]'}`} />
                  <div className="text-[10px] font-medium text-[#e0e7ff]">{c.label}</div>
                  <div className="text-[8px] text-[#5b6a92] leading-tight">{c.desc}</div>
                </div>
              )
            })}
          </div>
        </section>

        {/* memory */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[9px] tracking-[0.2em] text-[#5b6a92]">MEMORY BANK</div>
            <span className="text-[9px] text-[#5b6a92]">{memories.length} items</span>
          </div>
          <div className="space-y-1.5 max-h-72 overflow-y-auto scroll-cyan pr-1">
            {memories.length === 0 ? (
              <div className="text-[10px] text-[#5b6a92] italic text-center py-3 glass rounded-lg">
                No memories yet. The agent will store preferences, goals, and facts here as you chat.
              </div>
            ) : (
              <AnimatePresence initial={false}>
                {memories.map((m) => (
                  <motion.div
                    key={m.id}
                    layout
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="glass rounded-md p-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-[10px] font-semibold text-cyan-200 truncate">
                        {m.key}
                      </div>
                      <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-purple-400/10 border border-purple-400/30 text-purple-200 flex-shrink-0">
                        {m.category}
                      </span>
                    </div>
                    <div className="text-[10px] text-[#9bb5d4] mt-1 leading-snug line-clamp-3">
                      {m.value}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
