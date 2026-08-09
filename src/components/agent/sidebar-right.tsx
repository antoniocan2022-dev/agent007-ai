'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Activity, Brain, BriefcaseBusiness, CheckCircle2, CircleDollarSign, GitBranch, AlertTriangle, Users, Zap } from 'lucide-react'
import { useChatStore } from '@/store/chat-store'

function StatusDot({ status }: { status: string }) {
  const active = status !== 'idle'
  return <span className="relative flex h-2 w-2"><span className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${active ? 'bg-cyan-400 animate-ping' : 'bg-emerald-400'}`} /><span className={`relative inline-flex rounded-full h-2 w-2 ${active ? 'bg-cyan-400' : 'bg-emerald-400'}`} /></span>
}

function Metric({ icon: Icon, label, value, hint }: { icon: typeof Activity; label: string; value: string; hint?: string }) {
  return <div className="glass rounded-lg p-3 border border-cyan-400/10"><div className="flex items-center gap-2 text-[9px] uppercase tracking-[0.18em] text-[#5b6a92]"><Icon className="w-3.5 h-3.5 text-cyan-300" />{label}</div><div className="text-lg font-semibold text-[#e0e7ff] mt-1">{value}</div>{hint && <div className="text-[9px] text-[#5b6a92] mt-0.5">{hint}</div>}</div>
}

export function SidebarRight({ onClose }: { onClose?: () => void }) {
  const status = useChatStore((s) => s.status)
  const currentTool = useChatStore((s) => s.currentTool)
  const memories = useChatStore((s) => s.memories)
  const subagentActivity = useChatStore((s) => s.subagentActivity)
  const subagentCount = useChatStore((s) => s.subagentCount)
  const [showMemory, setShowMemory] = useState(false)

  const activeAgents = Object.values(subagentActivity).filter((v) => v !== 'idle').length
  const statusLabel = status === 'idle' ? 'Operational' : status === 'thinking' ? 'CEO reasoning' : status === 'tool_running' ? `Executing ${currentTool ?? 'mission step'}` : 'Responding'

  return (
    <div className="h-full flex flex-col glass-strong border-l border-cyan-400/15">
      <div className="p-3 flex items-center justify-between border-b border-cyan-400/10"><div className="flex items-center gap-2"><Activity className="w-4 h-4 text-cyan-300" /><span className="text-xs font-semibold tracking-wider text-[#e0e7ff]">EXECUTIVE CONTEXT</span></div>{onClose && <button onClick={onClose} className="md:hidden text-[#7c89b5] hover:text-cyan-300" aria-label="Close context"><X className="w-4 h-4" /></button>}</div>
      <div className="flex-1 overflow-y-auto scroll-cyan p-3 space-y-3">
        <section className="glass rounded-xl p-3 border border-cyan-400/20"><div className="flex items-center justify-between"><div className="flex items-center gap-2"><StatusDot status={status} /><span className="text-xs font-semibold text-[#e0e7ff]">{statusLabel}</span></div><Zap className="w-3.5 h-3.5 text-cyan-300" /></div><p className="text-[10px] text-[#7c89b5] mt-2 leading-relaxed">CEO_AGENT007 coordinates missions, specialists, resources and verification from this workspace.</p></section>
        <section><div className="text-[9px] tracking-[0.2em] text-[#5b6a92] mb-2">EXECUTIVE SNAPSHOT</div><div className="grid grid-cols-2 gap-2"><Metric icon={CircleDollarSign} label="Revenue" value="$0" hint="Live accounting" /><Metric icon={BriefcaseBusiness} label="Businesses" value="—" hint="Portfolio" /><Metric icon={GitBranch} label="Missions" value="—" hint="Active" /><Metric icon={AlertTriangle} label="Risks" value="0" hint="Open" /></div></section>
        <section className="glass rounded-lg p-3 border border-cyan-400/10"><div className="flex items-center justify-between mb-2"><div className="flex items-center gap-2 text-[9px] uppercase tracking-[0.18em] text-[#5b6a92]"><Users className="w-3.5 h-3.5 text-cyan-300" />Organization</div><span className="text-[9px] text-cyan-200">{subagentCount || 0} specialists</span></div><div className="flex items-center justify-between text-[10px] text-[#9bb5d4]"><span>Active now</span><span className="text-[#e0e7ff]">{activeAgents}</span></div><div className="mt-2 h-1.5 rounded-full bg-white/5 overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-purple-500" style={{ width: `${Math.min(100, (activeAgents / Math.max(1, subagentCount || 1)) * 100)}%` }} /></div></section>
        <section><button onClick={() => setShowMemory((v) => !v)} className="w-full glass rounded-lg p-3 border border-cyan-400/10 flex items-center justify-between text-left hover:border-cyan-400/30 transition"><div className="flex items-center gap-2"><Brain className="w-3.5 h-3.5 text-purple-300" /><span className="text-[10px] font-semibold text-[#e0e7ff]">Knowledge & memory</span></div><span className="text-[9px] text-[#5b6a92]">{memories.length} items</span></button><AnimatePresence initial={false}>{showMemory && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden"><div className="pt-2 space-y-1.5 max-h-56 overflow-y-auto scroll-cyan">{memories.length === 0 ? <div className="text-[10px] text-[#5b6a92] italic p-3 glass rounded-lg">No memories yet.</div> : memories.map((m) => { const value = typeof m.value === 'string' ? m.value : (() => { try { return JSON.stringify(m.value) } catch { return String(m.value) } })(); return <div key={m.id} className="glass rounded-md p-2"><div className="text-[10px] font-semibold text-cyan-200 truncate">{m.key}</div><div className="text-[9px] text-[#9bb5d4] mt-1 line-clamp-3">{value}</div></div> })}</div></motion.div>}</AnimatePresence></section>
        <div className="text-[9px] text-[#5b6a92] leading-relaxed flex gap-1.5 items-start"><CheckCircle2 className="w-3 h-3 text-emerald-400 flex-shrink-0 mt-0.5" />Technical telemetry remains available through System/Operations rather than occupying the primary CEO workspace.</div>
      </div>
    </div>
  )
}
