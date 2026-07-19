'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, Palette, CheckCircle, Hammer, Activity, Settings as SettingsIcon,
  Shield, Send, X, Loader2, Users, Zap,
} from 'lucide-react'

interface Pod {
  id: string
  name: string
  leader: string
  members: string[]
  focus: string
  color: string
  icon: string
  toolCount: number
  status: string
}

const POD_ICONS: Record<string, any> = {
  scout: Search,
  aurora: Palette,
  echo: CheckCircle,
  forge: Hammer,
  pulse: Activity,
  developer: SettingsIcon,
  cybersecurity_r: Shield,
}

export function PodsTab() {
  const [pods, setPods] = useState<Pod[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedPod, setSelectedPod] = useState<Pod | null>(null)
  const [leaderMessage, setLeaderMessage] = useState('')
  const [leaderResponse, setLeaderResponse] = useState('')
  const [sending, setSending] = useState(false)

  const loadPods = useCallback(async () => {
    try {
      const res = await fetch('/api/team/scout?action=pods')
      const data = await res.json()
      if (data.ok && data.pods) {
        setPods(data.pods)
      }
    } catch {
      // fallback to static pods
      setPods([
        { id: 'scout', name: 'Intelligence & Research', leader: 'SCOUT', members: ['HUNT', 'QUANTUM'], focus: 'Find opportunities, validate demand, research competitors', color: '#38bdf8', icon: 'scout', toolCount: 667, status: 'ready' },
        { id: 'aurora', name: 'Creation & Design', leader: 'AURORA', members: ['QUILL', 'PRISM', 'VERTEX', 'Content Specialist'], focus: 'Create content, design products, build affiliate funnels', color: '#00f0ff', icon: 'aurora', toolCount: 667, status: 'ready' },
        { id: 'echo', name: 'Quality Assurance', leader: 'ECHO', members: ['QA Monitor', 'Performance Analyst'], focus: 'Test, verify, score quality, ensure 99% target', color: '#818cf8', icon: 'echo', toolCount: 667, status: 'ready' },
        { id: 'forge', name: 'Engineering', leader: 'FORGE', members: ['Developer', 'TRADER'], focus: 'Build, deploy, fix infrastructure, execute trades', color: '#fb923c', icon: 'forge', toolCount: 667, status: 'ready' },
        { id: 'pulse', name: 'Monitoring & Ops', leader: 'PULSE', members: ['External Monitor', 'THE BANKER'], focus: 'Monitor systems, track KPIs, financial monitoring', color: '#fb7185', icon: 'pulse', toolCount: 667, status: 'ready' },
        { id: 'developer', name: 'System Health', leader: 'Developer', members: ['QA Monitor', 'External Monitor'], focus: 'Tool health, API monitoring, infrastructure repair', color: '#10b981', icon: 'developer', toolCount: 667, status: 'ready' },
        { id: 'cybersecurity_r', name: 'Compliance & Security', leader: 'Cybersecurity R', members: ['LEGAL', 'Cybersecurity A', 'THE BANKER'], focus: 'Legal compliance, tax strategy, security auditing', color: '#3b82f6', icon: 'cybersecurity_r', toolCount: 667, status: 'ready' },
      ])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadPods()
  }, [loadPods])

  const sendToLeader = async () => {
    if (!selectedPod || !leaderMessage.trim()) return
    setSending(true)
    setLeaderResponse('')
    try {
      const res = await fetch(`/api/team/${selectedPod.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: leaderMessage }),
      })
      const data = await res.json()
      if (data.ok) {
        setLeaderResponse(data.response || 'No response from leader.')
      } else {
        setLeaderResponse(`Error: ${data.error || 'Unknown error'}`)
      }
    } catch (e: any) {
      setLeaderResponse(`Network error: ${e?.message}`)
    } finally {
      setSending(false)
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-cyan-300" />
        <span className="ml-2 text-sm text-[#7c89b5]">Loading pods...</span>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto scroll-cyan p-4 sm:p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            <span className="neon-text-cyan">Team</span>{' '}
            <span className="neon-text-purple">Pods</span>
          </h1>
          <p className="text-xs text-[#7c89b5] mt-1 tracking-wide">
            7 specialized teams • 20 agents • 667 tools • Click any pod to communicate with its leader
          </p>
        </div>

        {/* Pod Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {pods.map((pod, i) => {
            const Icon = POD_ICONS[pod.id] || Users
            return (
              <motion.div
                key={pod.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="glass rounded-xl border overflow-hidden cursor-pointer hover:scale-[1.02] transition-transform"
                style={{ borderColor: `${pod.color}40` }}
                onClick={() => {
                  setSelectedPod(pod)
                  setLeaderMessage('')
                  setLeaderResponse('')
                }}
              >
                {/* Pod Header */}
                <div
                  className="p-3 flex items-center gap-2.5 border-b"
                  style={{ background: `linear-gradient(135deg, ${pod.color}15, ${pod.color}05)`, borderColor: `${pod.color}30` }}
                >
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: `${pod.color}20`, border: `1px solid ${pod.color}50` }}
                  >
                    <Icon className="w-4.5 h-4.5" style={{ color: pod.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-bold truncate" style={{ color: pod.color }}>
                      {pod.name}
                    </h3>
                    <p className="text-[10px] text-[#7c89b5]">
                      Leader: <span className="font-semibold text-[#cfd9f0]">{pod.leader}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-[9px] text-emerald-300 font-mono">READY</span>
                  </div>
                </div>

                {/* Pod Body */}
                <div className="p-3">
                  <p className="text-[11px] text-[#a5b4fc] mb-2.5 leading-relaxed">{pod.focus}</p>
                  <div className="flex flex-wrap gap-1 mb-2.5">
                    {pod.members.map((m) => (
                      <span
                        key={m}
                        className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 border text-[#cfd9f0]"
                        style={{ borderColor: `${pod.color}30` }}
                      >
                        {m}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center justify-between text-[9px] text-[#5b6a92] mb-2">
                    <span className="flex items-center gap-1">
                      <Zap className="w-2.5 h-2.5" /> {pod.toolCount} tools
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="w-2.5 h-2.5" /> {pod.members.length + 1} agents
                    </span>
                  </div>
                  <button
                    className="w-full py-1.5 rounded-lg text-[10px] font-semibold transition-all hover:brightness-125"
                    style={{
                      background: `${pod.color}15`,
                      border: `1px solid ${pod.color}40`,
                      color: pod.color,
                    }}
                  >
                    💬 Talk to {pod.leader}
                  </button>
                </div>
              </motion.div>
            )
          })}
        </div>

        {/* Summary Stats */}
        <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Pods', value: pods.length, color: '#00f0ff' },
            { label: 'Leaders', value: pods.length, color: '#a855f7' },
            { label: 'Total Agents', value: pods.reduce((s, p) => s + p.members.length + 1, 0), color: '#10b981' },
            { label: 'Tools per Pod', value: 667, color: '#f59e0b' },
          ].map((stat) => (
            <div key={stat.label} className="glass rounded-lg p-3 text-center border border-white/10">
              <div className="text-xl font-bold" style={{ color: stat.color }}>{stat.value}</div>
              <div className="text-[10px] text-[#7c89b5] uppercase tracking-wider mt-0.5">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Leader Chat Modal */}
      <AnimatePresence>
        {selectedPod && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            onClick={() => setSelectedPod(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="glass-strong rounded-2xl p-5 max-w-lg w-full max-h-[80vh] overflow-y-auto"
              style={{ borderColor: `${selectedPod.color}40` }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center"
                    style={{ background: `${selectedPod.color}20`, border: `1px solid ${selectedPod.color}50` }}
                  >
                    {(() => {
                      const Icon = POD_ICONS[selectedPod.id] || Users
                      return <Icon className="w-4 h-4" style={{ color: selectedPod.color }} />
                    })()}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold" style={{ color: selectedPod.color }}>
                      {selectedPod.name}
                    </h3>
                    <p className="text-[10px] text-[#7c89b5]">
                      Leader: {selectedPod.leader} • Team: {selectedPod.members.join(', ')}
                    </p>
                  </div>
                </div>
                <button onClick={() => setSelectedPod(null)} className="text-[#7c89b5] hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <p className="text-[11px] text-[#a5b4fc] mb-3">{selectedPod.focus}</p>

              <textarea
                value={leaderMessage}
                onChange={(e) => setLeaderMessage(e.target.value)}
                rows={3}
                placeholder={`Send a message to ${selectedPod.leader}...`}
                className="w-full glass rounded-lg p-2.5 text-sm text-[#e0e7ff] placeholder:text-[#5b6a92] outline-none focus:border-cyan-400/70 border border-white/10 mb-2"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    sendToLeader()
                  }
                }}
              />
              <button
                onClick={sendToLeader}
                disabled={sending || !leaderMessage.trim()}
                className="w-full py-2 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
                style={{
                  background: `${selectedPod.color}15`,
                  border: `1px solid ${selectedPod.color}40`,
                  color: selectedPod.color,
                }}
              >
                {sending ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Sending to {selectedPod.leader}...</>
                ) : (
                  <><Send className="w-3.5 h-3.5" /> Send to {selectedPod.leader}</>
                )}
              </button>

              {leaderResponse && (
                <div className="mt-3 p-3 glass rounded-lg border-l-2 text-xs text-[#cfd9f0] whitespace-pre-wrap max-h-60 overflow-y-auto" style={{ borderLeftColor: selectedPod.color }}>
                  <div className="text-[10px] font-semibold mb-1" style={{ color: selectedPod.color }}>
                    🤖 {selectedPod.leader}:
                  </div>
                  {leaderResponse}
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
