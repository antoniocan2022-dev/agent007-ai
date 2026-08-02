'use client'

/**
 * MissionActiveTab — UPGRADE #111
 * Shows active missions as a chain: Team A → Team B → Team C → ...
 * - Click any team in the chain to see stage details
 * - Open access to ask the current stage leader directly how the mission is going
 * - Leader responds with concrete status, blockers, ETA
 */
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  GitBranch, Search, Palette, CheckCircle, Hammer, Activity,
  Settings as SettingsIcon, Shield, Zap, ArrowRight, ArrowLeft,
  X, Loader2, Send, Crown, RefreshCw, Plus, AlertTriangle,
  CheckCircle2, Clock, ChevronRight, MessageSquare, TrendingUp,
  type LucideIcon,
} from 'lucide-react'

interface StageHandoff {
  stage: string
  team: string
  leader: string
  status: 'pending' | 'active' | 'done' | 'blocked'
  startedAt: string | null
  completedAt: string | null
  notes: string
  artifacts: string[]
}

interface MissionLogEntry {
  timestamp: string
  actor: string
  stage: string
  message: string
}

interface LeaderMessage {
  id: string
  from: 'OWNER' | 'LEADER'
  author: string
  text: string
  timestamp: string
}

interface LeaderThread {
  id: string
  missionId: string
  leaderId: string
  leaderName: string
  stage: string
  messages: LeaderMessage[]
}

interface ActiveMission {
  id: string
  title: string
  description: string
  revenueTarget: number
  createdAt: string
  updatedAt: string
  currentStage: string
  priority: 'low' | 'medium' | 'high' | 'critical'
  category: string
  chain: StageHandoff[]
  log: MissionLogEntry[]
  threads: LeaderThread[]
}

const POD_ICONS: Record<string, LucideIcon> = {
  scout: Search,
  aurora: Palette,
  echo: CheckCircle,
  forge: Hammer,
  pulse: Activity,
  developer: SettingsIcon,
  cybersecurity_r: Shield,
  revenue: TrendingUp,
}

const POD_COLORS: Record<string, string> = {
  scout: '#38bdf8',
  aurora: '#00f0ff',
  echo: '#818cf8',
  forge: '#fb923c',
  pulse: '#fb7185',
  developer: '#10b981',
  cybersecurity_r: '#3b82f6',
  revenue: '#fbbf24',
}

const STAGE_COLORS: Record<string, string> = {
  PLANNED: '#5b6a92',
  IN_PROGRESS: '#f59e0b',
  REVIEW: '#a855f7',
  DELIVERED: '#06b6d4',
  VERIFIED: '#10b981',
  OWNER_APPROVAL: '#fb7185',
  COMPLETED: '#22c55e',
}

const PRIORITY_BADGE: Record<string, { bg: string; text: string; icon: LucideIcon }> = {
  low: { bg: 'rgba(91,106,146,0.15)', text: '#9bb5d4', icon: Clock },
  medium: { bg: 'rgba(0,240,255,0.12)', text: '#00f0ff', icon: Zap },
  high: { bg: 'rgba(251,146,60,0.12)', text: '#fb923c', icon: AlertTriangle },
  critical: { bg: 'rgba(251,113,133,0.15)', text: '#fb7185', icon: AlertTriangle },
}

function relativeTime(iso: string | null): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`
  return `${Math.round(diff / 86_400_000)}d ago`
}

export function MissionActiveTab() {
  const [missions, setMissions] = useState<ActiveMission[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedMission, setSelectedMission] = useState<ActiveMission | null>(null)
  const [selectedStageIdx, setSelectedStageIdx] = useState<number>(0)
  const [showCreate, setShowCreate] = useState(false)
  const [activeView, setActiveView] = useState<'missions' | 'telemetry' | 'observability'>('missions')

  // Leader chat state
  const [chatInput, setChatInput] = useState('')
  const [chatSending, setChatSending] = useState(false)
  const [chatError, setChatError] = useState('')

  // Telemetry state
  const [telemetryData, setTelemetryData] = useState<any[]>([])
  const [telemetryLoading, setTelemetryLoading] = useState(false)

  // Observability state
  const [observabilityData, setObservabilityData] = useState<any>(null)
  const [observabilityLoading, setObservabilityLoading] = useState(false)

  // Fetch telemetry data
  const fetchTelemetry = useCallback(async () => {
    setTelemetryLoading(true)
    try {
      const r = await fetch('/api/system/telemetry?limit=50')
      const d = await r.json()
      setTelemetryData(d.missions || [])
    } catch { setTelemetryData([]) }
    setTelemetryLoading(false)
  }, [])

  // Fetch observability data
  const fetchObservability = useCallback(async () => {
    setObservabilityLoading(true)
    try {
      const r = await fetch('/api/system/observability')
      const d = await r.json()
      setObservabilityData(d)
    } catch { setObservabilityData(null) }
    setObservabilityLoading(false)
  }, [])

  // Load telemetry/observability when switching to those tabs
  useEffect(() => {
    if (activeView === 'telemetry' && telemetryData.length === 0) fetchTelemetry()
    if (activeView === 'observability' && !observabilityData) fetchObservability()
  }, [activeView])

  const loadMissions = useCallback(async () => {
    try {
      const res = await fetch('/api/mission-active', { cache: 'no-store' })
      const data = await res.json()
      if (data.ok && Array.isArray(data.missions)) {
        setMissions(data.missions)
        // Keep the selected mission in sync with the latest data
        if (selectedMission) {
          const updated = data.missions.find((m: ActiveMission) => m.id === selectedMission.id)
          if (updated) setSelectedMission(updated)
        }
      }
    } catch (e) {
      // ignore — keep stale
    } finally {
      setLoading(false)
    }
  }, [selectedMission])

  useEffect(() => {
    loadMissions()
    // UPGRADE #115 — Reduced polling from 20s to 60s.
    // The 20s poll was firing fetch on every tab even when nothing was changing,
    // contributing to the sluggish feel. 60s is enough — user can click Refresh.
    const t = setInterval(loadMissions, 60_000)
    return () => clearInterval(t)
  }, [loadMissions])

  const openMission = (m: ActiveMission) => {
    setSelectedMission(m)
    const stageIdx = m.chain.findIndex((c) => c.stage === m.currentStage)
    setSelectedStageIdx(stageIdx >= 0 ? stageIdx : 0)
  }

  const sendToLeader = async () => {
    if (!selectedMission || !chatInput.trim()) return
    setChatSending(true)
    setChatError('')
    try {
      // UPGRADE #143 — Add 55s client-side timeout (server maxDuration is 60s).
      // Before: no timeout — UI showed "SCOUT is responding..." forever if server hung.
      // After: clean error message after 55s, leader message still saved to DB.
      const res = await fetch(`/api/mission-active/${selectedMission.id}?action=ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: chatInput }),
        signal: AbortSignal.timeout(55_000),
      })
      const data = await res.json()
      if (data.ok) {
        setChatInput('')
        if (data.mission) setSelectedMission(data.mission)
        else loadMissions()
      } else {
        setChatError(data.error || 'Failed to send')
      }
    } catch (e: any) {
      // Distinguish timeout from network error for clearer UX
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
        setChatError('Leader took too long to respond (>55s). Your message was saved — refresh in 30s to see the leader\'s reply.')
      } else {
        setChatError(e?.message || 'Network error')
      }
    } finally {
      setChatSending(false)
    }
  }

  const advanceStage = async () => {
    if (!selectedMission) return
    try {
      const res = await fetch('/api/mission-active?action=advance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ missionId: selectedMission.id }),
      })
      const data = await res.json()
      if (data.ok && data.mission) {
        setSelectedMission(data.mission)
        loadMissions()
      }
    } catch (e) {
      // ignore
    }
  }

  const approveMission = async () => {
    if (!selectedMission) return
    if (!confirm('Approve this mission and mark it as COMPLETED?')) return
    try {
      const res = await fetch('/api/mission-active?action=approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ missionId: selectedMission.id }),
      })
      const data = await res.json()
      if (data.ok && data.mission) {
        setSelectedMission(data.mission)
        loadMissions()
      }
    } catch (e) {
      // ignore
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-cyan-300" />
        <span className="ml-2 text-sm text-[#7c89b5]">Loading active missions...</span>
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────
  // DETAIL VIEW — show one mission with its team chain + chat
  // ─────────────────────────────────────────────────────────────
  if (selectedMission) {
    const chain = selectedMission.chain
    const currentIdx = chain.findIndex((c) => c.stage === selectedMission.currentStage)
    const activeHandoff = chain[selectedStageIdx]
    // UPGRADE #154 (Issue #2 fix): Look up thread by CURRENT STAGE, not selected stage.
    // Before: used `activeHandoff?.team` (the user-selected stage) to find the thread.
    // But the server stores threads under the CURRENT stage's team. If the user
    // selected a different stage than the current one, the thread lookup failed
    // and no messages were shown — making it look like the leader "never responded."
    // After: find the thread for the CURRENT stage (where the leader actually is),
    // so messages are always visible regardless of which stage the user clicked.
    const currentHandoff = chain[currentIdx]
    const activeThread = selectedMission.threads.find(
      (t) => t.leaderId === currentHandoff?.team && t.stage === currentHandoff?.stage
    )
    const isOwnerApproval = selectedMission.currentStage === 'OWNER_APPROVAL'
    const isCompleted = selectedMission.currentStage === 'COMPLETED'

    return (
      <div className="flex-1 overflow-y-auto scroll-cyan p-4 sm:p-6">
        <div className="max-w-6xl mx-auto">
          {/* Back button */}
          <button
            onClick={() => setSelectedMission(null)}
            className="flex items-center gap-1 text-xs text-[#7c89b5] hover:text-cyan-300 mb-4 transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to all missions
          </button>

          {/* Mission header */}
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass glass-strong rounded-xl p-5 mb-5"
          >
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <h1 className="text-xl font-bold neon-text-cyan">{selectedMission.title}</h1>
                  <span
                    className="text-[10px] px-2 py-0.5 rounded-full font-bold"
                    style={{
                      background: (PRIORITY_BADGE[selectedMission.priority] || PRIORITY_BADGE.medium).bg,
                      color: (PRIORITY_BADGE[selectedMission.priority] || PRIORITY_BADGE.medium).text,
                      border: `1px solid ${(PRIORITY_BADGE[selectedMission.priority] || PRIORITY_BADGE.medium).text}40`,
                    }}
                  >
                    {selectedMission.priority.toUpperCase()}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-400/10 border border-cyan-400/30 text-cyan-200 font-bold">
                    {selectedMission.category}
                  </span>
                </div>
                <p className="text-sm text-[#9bb5d4] leading-relaxed">{selectedMission.description}</p>
                <div className="flex items-center gap-4 mt-2 text-[10px] text-[#5b6a92]">
                  <span>Target: <span className="text-emerald-300 font-bold">${selectedMission.revenueTarget}/mo</span></span>
                  <span>Updated: {relativeTime(selectedMission.updatedAt)}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {!isCompleted && !isOwnerApproval && (
                  <button
                    onClick={advanceStage}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-cyan-400/10 border border-cyan-400/40 text-cyan-200 hover:bg-cyan-400/20 transition"
                  >
                    <ArrowRight className="w-3.5 h-3.5" />
                    Advance Stage
                  </button>
                )}
                {isOwnerApproval && (
                  <button
                    onClick={approveMission}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-emerald-400/15 border border-emerald-400/50 text-emerald-200 hover:bg-emerald-400/25 transition"
                  >
                    <Crown className="w-3.5 h-3.5" />
                    Approve Mission
                  </button>
                )}
                <button
                  onClick={loadMissions}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-white/5 border border-white/10 text-[#9bb5d4] hover:bg-white/10 transition"
                  title="Refresh"
                >
                  <RefreshCw className="w-3 h-3" />
                </button>
              </div>
            </div>
          </motion.div>

          {/* ───────── TEAM CHAIN ───────── */}
          {/* Visual: Team A → Team B → Team C → ... */}
          <div className="glass rounded-xl p-5 mb-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-[#e0e7ff] flex items-center gap-2">
                <GitBranch className="w-4 h-4 text-cyan-300" />
                Team Chain Workflow
              </h2>
              <div className="text-[10px] text-[#5b6a92]">
                Click any team to see stage details & chat with leader
              </div>
            </div>

            {/* Chain visualization — horizontal on desktop, vertical on mobile */}
            <div className="flex flex-col lg:flex-row lg:items-stretch gap-2 lg:gap-0 overflow-x-auto scroll-cyan pb-2">
              {chain.map((handoff, idx) => {
                const Icon = POD_ICONS[handoff.team] || SettingsIcon
                const color = POD_COLORS[handoff.team] || '#7c89b5'
                const isPast = idx < currentIdx
                const isActive = idx === currentIdx
                const isSelected = idx === selectedStageIdx
                const isFuture = idx > currentIdx

                return (
                  <div key={`${handoff.stage}-${idx}`} className="flex flex-col lg:flex-row lg:items-center">
                    {/* Card */}
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setSelectedStageIdx(idx)}
                      className={`relative flex items-center gap-3 px-4 py-3 rounded-xl border min-w-[200px] lg:min-w-[220px] transition-all ${
                        isSelected
                          ? 'bg-cyan-400/10 shadow-[0_0_20px_rgba(0,240,255,0.25)]'
                          : 'bg-white/[0.02] hover:bg-white/[0.05]'
                      }`}
                      style={{
                        borderColor: isSelected ? `${color}80` : isActive ? `${color}60` : 'rgba(255,255,255,0.08)',
                        boxShadow: isActive && !isSelected ? `0 0 12px ${color}30` : undefined,
                      }}
                    >
                      {/* Status ring around icon */}
                      <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 relative"
                        style={{
                          background: `${color}15`,
                          border: `1px solid ${color}50`,
                          color: color,
                        }}
                      >
                        <Icon className="w-5 h-5" />
                        {/* Status indicator dot */}
                        <div
                          className="absolute -top-1 -right-1 w-3 h-3 rounded-full border-2 border-[#0a0f1c]"
                          style={{
                            background: handoff.status === 'done' ? '#22c55e'
                              : handoff.status === 'active' ? '#f59e0b'
                              : handoff.status === 'blocked' ? '#ef4444'
                              : '#5b6a92',
                            animation: handoff.status === 'active' ? 'pulse 2s infinite' : undefined,
                          }}
                        />
                      </div>
                      {/* Text */}
                      <div className="flex-1 min-w-0 text-left">
                        <div className="text-[10px] text-[#5b6a92] tracking-wider font-bold uppercase">
                          {handoff.stage.replace(/_/g, ' ')}
                        </div>
                        <div className="text-sm font-bold text-[#e0e7ff] truncate">
                          {handoff.leader}
                        </div>
                        <div className="text-[10px] mt-0.5 flex items-center gap-1">
                          {handoff.status === 'done' && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
                          {handoff.status === 'active' && <Clock className="w-3 h-3 text-amber-400" />}
                          {handoff.status === 'pending' && <Clock className="w-3 h-3 text-[#5b6a92]" />}
                          <span
                            className="font-semibold"
                            style={{
                              color: handoff.status === 'done' ? '#22c55e'
                                : handoff.status === 'active' ? '#f59e0b'
                                : handoff.status === 'blocked' ? '#ef4444'
                                : '#5b6a92',
                            }}
                          >
                            {handoff.status === 'done' ? 'Done'
                              : handoff.status === 'active' ? 'Working now'
                              : handoff.status === 'blocked' ? 'Blocked'
                              : 'Waiting'}
                          </span>
                          {handoff.completedAt && (
                            <span className="text-[#5b6a92]">• {relativeTime(handoff.completedAt)}</span>
                          )}
                        </div>
                      </div>
                      {/* Stage number badge */}
                      <div
                        className="absolute -top-2 -left-2 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold"
                        style={{
                          background: isActive ? color : isPast ? '#22c55e' : '#2a3450',
                          color: isActive || isPast ? '#0a0f1c' : '#7c89b5',
                        }}
                      >
                        {idx + 1}
                      </div>
                    </motion.button>

                    {/* Arrow connector */}
                    {idx < chain.length - 1 && (
                      <div className="flex items-center justify-center px-1 lg:px-1 py-0.5 lg:py-0">
                        <ChevronRight className="w-4 h-4 text-[#5b6a92] rotate-90 lg:rotate-0" />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* ───────── STAGE DETAILS + LEADER CHAT ───────── */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            {/* Stage details — left */}
            <div className="lg:col-span-2 glass rounded-xl p-5">
              <h3 className="text-sm font-bold text-[#e0e7ff] mb-3 flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-cyan-300" />
                Stage Details
              </h3>
              {activeHandoff && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center"
                      style={{
                        background: `${POD_COLORS[activeHandoff.team] || '#7c89b5'}15`,
                        border: `1px solid ${POD_COLORS[activeHandoff.team] || '#7c89b5'}50`,
                        color: POD_COLORS[activeHandoff.team] || '#7c89b5',
                      }}
                    >
                      {(() => {
                        const Icon = POD_ICONS[activeHandoff.team] || SettingsIcon
                        return <Icon className="w-4 h-4" />
                      })()}
                    </div>
                    <div>
                      <div className="text-sm font-bold text-[#e0e7ff]">{activeHandoff.leader}</div>
                      <div className="text-[10px] text-[#5b6a92] uppercase tracking-wider">
                        {activeHandoff.stage.replace(/_/g, ' ')}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-[#7c89b5]">Status</span>
                      <span
                        className="font-bold"
                        style={{
                          color: activeHandoff.status === 'done' ? '#22c55e'
                            : activeHandoff.status === 'active' ? '#f59e0b'
                            : activeHandoff.status === 'blocked' ? '#ef4444'
                            : '#5b6a92',
                        }}
                      >
                        {activeHandoff.status.toUpperCase()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#7c89b5]">Started</span>
                      <span className="text-[#9bb5d4]">{relativeTime(activeHandoff.startedAt)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#7c89b5]">Completed</span>
                      <span className="text-[#9bb5d4]">{relativeTime(activeHandoff.completedAt)}</span>
                    </div>
                  </div>

                  {activeHandoff.notes && (
                    <div className="mt-3 p-2.5 rounded-lg bg-black/20 border border-white/5 text-xs text-[#9bb5d4] leading-relaxed">
                      {activeHandoff.notes}
                    </div>
                  )}

                  {activeHandoff.artifacts.length > 0 && (
                    <div className="mt-3">
                      <div className="text-[10px] text-[#5b6a92] tracking-wider uppercase font-bold mb-1.5">Artifacts</div>
                      <div className="space-y-1">
                        {activeHandoff.artifacts.map((a, i) => (
                          <div key={i} className="text-xs text-cyan-300 flex items-center gap-1.5 truncate">
                            <ChevronRight className="w-3 h-3" />
                            {a}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Mini audit log */}
                  <div className="mt-4 pt-3 border-t border-white/5">
                    <div className="text-[10px] text-[#5b6a92] tracking-wider uppercase font-bold mb-2">Recent Activity</div>
                    <div className="space-y-1.5 max-h-40 overflow-y-auto scroll-cyan">
                      {selectedMission.log.slice(-5).reverse().map((entry, i) => (
                        <div key={i} className="text-[10px] flex gap-2">
                          <span className="text-[#5b6a92] flex-shrink-0">{relativeTime(entry.timestamp)}</span>
                          <span className="text-[#9bb5d4]">
                            <span className="text-cyan-300 font-bold">{entry.actor}</span> — {entry.message}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Leader chat — right (3/5) */}
            <div className="lg:col-span-3 glass rounded-xl p-5 flex flex-col" style={{ minHeight: '420px' }}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-[#e0e7ff] flex items-center gap-2">
                  <Crown className="w-4 h-4 text-amber-300" />
                  Direct Line to {activeHandoff?.leader || 'Leader'}
                </h3>
                {activeHandoff && (
                  <span
                    className="text-[10px] px-2 py-0.5 rounded-full font-bold"
                    style={{
                      background: `${STAGE_COLORS[activeHandoff.stage] || '#5b6a92'}20`,
                      color: STAGE_COLORS[activeHandoff.stage] || '#5b6a92',
                      border: `1px solid ${STAGE_COLORS[activeHandoff.stage] || '#5b6a92'}40`,
                    }}
                  >
                    {activeHandoff.stage.replace(/_/g, ' ')}
                  </span>
                )}
              </div>

              {/* Suggested prompts */}
              {(!activeThread || activeThread.messages.length === 0) && (
                <div className="mb-3">
                  <div className="text-[10px] text-[#5b6a92] mb-1.5 uppercase tracking-wider font-bold">Quick questions</div>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      "How are we going with the mission?",
                      "What's blocking you right now?",
                      "What's your ETA to hand off?",
                      "What do you need from me?",
                    ].map((q) => (
                      <button
                        key={q}
                        onClick={() => setChatInput(q)}
                        className="text-[11px] px-2.5 py-1 rounded-full bg-cyan-400/5 border border-cyan-400/20 text-cyan-200 hover:bg-cyan-400/15 transition"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Chat messages */}
              <div className="flex-1 overflow-y-auto scroll-cyan space-y-3 mb-3 pr-1">
                {(!activeThread || activeThread.messages.length === 0) && (
                  <div className="text-center py-8 text-xs text-[#5b6a92]">
                    No messages yet. Ask {activeHandoff?.leader} how the mission is going.
                  </div>
                )}
                {activeThread?.messages.map((msg) => (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`flex ${msg.from === 'OWNER' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
                        msg.from === 'OWNER'
                          ? 'bg-cyan-400/10 border border-cyan-400/30 text-[#e0e7ff]'
                          : 'bg-white/[0.03] border border-white/10 text-[#cfd9f0]'
                      }`}
                    >
                      <div className="text-[9px] mb-0.5 font-bold tracking-wider uppercase opacity-70">
                        {msg.author} • {relativeTime(msg.timestamp)}
                      </div>
                      <div className="whitespace-pre-wrap">{msg.text}</div>
                    </div>
                  </motion.div>
                ))}
                {chatSending && (
                  <div className="flex justify-start">
                    <div className="bg-white/[0.03] border border-white/10 rounded-xl px-3 py-2 flex items-center gap-2 text-xs text-[#9bb5d4]">
                      <Loader2 className="w-3 h-3 animate-spin text-cyan-300" />
                      {activeHandoff?.leader} is responding...
                    </div>
                  </div>
                )}
              </div>

              {/* Composer */}
              <div className="border-t border-white/5 pt-3">
                {chatError && (
                  <div className="text-[10px] text-pink-300 mb-1.5">{chatError}</div>
                )}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !chatSending) sendToLeader()
                    }}
                    placeholder={`Ask ${activeHandoff?.leader || 'the leader'} about this stage...`}
                    className="flex-1 bg-black/30 border border-cyan-400/20 rounded-lg px-3 py-2 text-xs text-[#e0e7ff] placeholder:text-[#5b6a92] focus:outline-none focus:border-cyan-400/60"
                    disabled={chatSending}
                  />
                  <button
                    onClick={sendToLeader}
                    disabled={chatSending || !chatInput.trim()}
                    className="px-3 py-2 rounded-lg neon-btn-cyan text-xs font-bold flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Send
                  </button>
                </div>
                <div className="text-[9px] text-[#5b6a92] mt-1.5">
                  Your message is dispatched directly to {activeHandoff?.leader}. The leader will respond with concrete status, blockers, and ETA.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────
  // LIST VIEW — show all missions as compact chain cards
  // ─────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 overflow-y-auto scroll-cyan p-4 sm:p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between gap-3 flex-wrap">
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              <span className="neon-text-cyan">Mission</span>{' '}
              <span className="neon-text-purple">Actives</span>
            </h1>
            <p className="text-xs text-[#7c89b5] mt-1 tracking-wide">
              Live projects flowing through the team chain. Click any mission to see the full workflow and chat with the leader in charge.
            </p>
          </motion.div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadMissions}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-white/5 border border-white/10 text-[#9bb5d4] hover:bg-white/10 transition"
              title="Refresh"
            >
              <RefreshCw className="w-3 h-3" />
              Refresh
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold neon-btn-cyan"
            >
              <Plus className="w-3.5 h-3.5" />
              New Mission
            </button>
          </div>
        </div>

        {/* Navigation tabs — UPGRADE #218 */}
        <div className="mb-6 flex items-center gap-1 p-1 rounded-xl glass border border-cyan-400/10 max-w-md">
          <button
            onClick={() => setActiveView('missions')}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-bold transition ${
              activeView === 'missions' ? 'bg-cyan-400/15 text-cyan-300 border border-cyan-400/30' : 'text-[#7c89b5] hover:text-[#9bb5d4]'
            }`}
          >
            <GitBranch className="w-3.5 h-3.5" />
            Missions
          </button>
          <button
            onClick={() => setActiveView('telemetry')}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-bold transition ${
              activeView === 'telemetry' ? 'bg-cyan-400/15 text-cyan-300 border border-cyan-400/30' : 'text-[#7c89b5] hover:text-[#9bb5d4]'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            Telemetry
          </button>
          <button
            onClick={() => setActiveView('observability')}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-bold transition ${
              activeView === 'observability' ? 'bg-cyan-400/15 text-cyan-300 border border-cyan-400/30' : 'text-[#7c89b5] hover:text-[#9bb5d4]'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5" />
            Observability
          </button>
        </div>

        {/* ── TELEMETRY VIEW ── */}
        {activeView === 'telemetry' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-bold text-[#e0e7ff]">Mission Telemetry — Real Per-Mission Data</h2>
              <button onClick={fetchTelemetry} className="text-[10px] text-cyan-300 hover:text-cyan-200 flex items-center gap-1">
                <RefreshCw className="w-3 h-3" /> Refresh
              </button>
            </div>
            {telemetryLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
              </div>
            ) : telemetryData.length === 0 ? (
              <div className="text-center py-12 text-[#5b6a92] text-xs">
                No telemetry data yet. Run a mission to generate real telemetry.
              </div>
            ) : (
              telemetryData.map((m: any, i: number) => (
                <motion.div
                  key={m.missionId || i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="rounded-xl glass border border-cyan-400/10 p-4"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="text-xs font-mono text-cyan-300">{m.missionId?.slice(0, 20) || '—'}</div>
                      <div className="text-[11px] text-[#9bb5d4] mt-0.5">{m.goal || '—'}</div>
                    </div>
                    <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold ${
                      m.status === 'completed' ? 'bg-emerald-500/15 text-emerald-300' :
                      m.status === 'failed' ? 'bg-red-500/15 text-red-300' :
                      'bg-amber-500/15 text-amber-300'
                    }`}>
                      {m.status?.toUpperCase() || 'UNKNOWN'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 text-[10px]">
                    <div className="bg-black/20 rounded-lg p-2">
                      <div className="text-[#5b6a92] mb-0.5">Duration</div>
                      <div className="text-[#e0e7ff] font-mono">{m.duration ? `${(m.duration / 1000).toFixed(1)}s` : '—'}</div>
                    </div>
                    <div className="bg-black/20 rounded-lg p-2">
                      <div className="text-[#5b6a92] mb-0.5">Leaders</div>
                      <div className="text-[#e0e7ff] font-mono">{m.leadersUsed?.length || 0}</div>
                    </div>
                    <div className="bg-black/20 rounded-lg p-2">
                      <div className="text-[#5b6a92] mb-0.5">Tools Called</div>
                      <div className="text-[#e0e7ff] font-mono">{m.toolCallCount || 0}</div>
                    </div>
                    <div className="bg-black/20 rounded-lg p-2">
                      <div className="text-[#5b6a92] mb-0.5">Retries</div>
                      <div className="text-[#e0e7ff] font-mono">{m.retries || 0}</div>
                    </div>
                    <div className="bg-black/20 rounded-lg p-2">
                      <div className="text-[#5b6a92] mb-0.5">Memory R/W</div>
                      <div className="text-[#e0e7ff] font-mono">{m.memoryReads || 0}/{m.memoryWrites || 0}</div>
                    </div>
                    <div className="bg-black/20 rounded-lg p-2">
                      <div className="text-[#5b6a92] mb-0.5">Confidence</div>
                      <div className={`font-mono ${m.confidence >= 85 ? 'text-emerald-300' : m.confidence >= 60 ? 'text-amber-300' : 'text-red-300'}`}>
                        {m.confidence || 0}%
                      </div>
                    </div>
                    <div className="bg-black/20 rounded-lg p-2">
                      <div className="text-[#5b6a92] mb-0.5">Verification</div>
                      <div className={`font-mono ${m.verificationPassed ? 'text-emerald-300' : 'text-red-300'}`}>
                        {m.verificationScore || 0}%
                      </div>
                    </div>
                    <div className="bg-black/20 rounded-lg p-2">
                      <div className="text-[#5b6a92] mb-0.5">Errors</div>
                      <div className="text-[#e0e7ff] font-mono">{m.errors?.length || 0}</div>
                    </div>
                    <div className="bg-black/20 rounded-lg p-2">
                      <div className="text-[#5b6a92] mb-0.5">Cost</div>
                      <div className="text-[#e0e7ff] font-mono">${(m.cost || 0).toFixed(4)}</div>
                    </div>
                    <div className="bg-black/20 rounded-lg p-2">
                      <div className="text-[#5b6a92] mb-0.5">Tokens</div>
                      <div className="text-[#e0e7ff] font-mono">{m.tokensUsed || 0}</div>
                    </div>
                    <div className="bg-black/20 rounded-lg p-2">
                      <div className="text-[#5b6a92] mb-0.5">Latency</div>
                      <div className="text-[#e0e7ff] font-mono">{m.latencyMs ? `${m.latencyMs}ms` : '—'}</div>
                    </div>
                    <div className="bg-black/20 rounded-lg p-2">
                      <div className="text-[#5b6a92] mb-0.5">Debate</div>
                      <div className={`font-mono ${m.debateTriggered ? 'text-cyan-300' : 'text-[#5b6a92]'}`}>
                        {m.debateTriggered ? 'YES' : 'NO'}
                      </div>
                    </div>
                  </div>
                  {m.errors && m.errors.length > 0 && (
                    <div className="mt-2 text-[9px] text-red-300/70">
                      Errors: {m.errors.join('; ').slice(0, 150)}
                    </div>
                  )}
                </motion.div>
              ))
            )}
          </div>
        )}

        {/* ── OBSERVABILITY VIEW ── */}
        {activeView === 'observability' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-bold text-[#e0e7ff]">Observability — Aggregate Mission Metrics</h2>
              <button onClick={fetchObservability} className="text-[10px] text-cyan-300 hover:text-cyan-200 flex items-center gap-1">
                <RefreshCw className="w-3 h-3" /> Refresh
              </button>
            </div>
            {observabilityLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
              </div>
            ) : !observabilityData || observabilityData.totalMissions === 0 ? (
              <div className="text-center py-12 text-[#5b6a92] text-xs">
                No observability data yet. Run missions to generate aggregate metrics.
              </div>
            ) : (
              <>
                {/* KPI Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  <div className="rounded-xl glass border border-emerald-400/20 p-4">
                    <div className="text-[9px] text-[#5b6a92] uppercase tracking-wider mb-1">Mission Success</div>
                    <div className="text-2xl font-bold text-emerald-300">{observabilityData.missionSuccessRate?.toFixed(1)}%</div>
                    <div className="text-[9px] text-[#5b6a92] mt-1">{observabilityData.totalMissions} total missions</div>
                  </div>
                  <div className="rounded-xl glass border border-cyan-400/20 p-4">
                    <div className="text-[9px] text-[#5b6a92] uppercase tracking-wider mb-1">Average Latency</div>
                    <div className="text-2xl font-bold text-cyan-300">{(observabilityData.averageLatencyMs / 1000).toFixed(1)}s</div>
                    <div className="text-[9px] text-[#5b6a92] mt-1">first response</div>
                  </div>
                  <div className="rounded-xl glass border border-red-400/20 p-4">
                    <div className="text-[9px] text-[#5b6a92] uppercase tracking-wider mb-1">Verification Failures</div>
                    <div className="text-2xl font-bold text-red-300">{observabilityData.verificationFailureRate?.toFixed(1)}%</div>
                    <div className="text-[9px] text-[#5b6a92] mt-1">failed verification</div>
                  </div>
                  <div className="rounded-xl glass border border-purple-400/20 p-4">
                    <div className="text-[9px] text-[#5b6a92] uppercase tracking-wider mb-1">Leader Debate Usage</div>
                    <div className="text-2xl font-bold text-purple-300">{observabilityData.leaderDebateUsage?.toFixed(0)}%</div>
                    <div className="text-[9px] text-[#5b6a92] mt-1">missions with debate</div>
                  </div>
                  <div className="rounded-xl glass border border-cyan-400/20 p-4">
                    <div className="text-[9px] text-[#5b6a92] uppercase tracking-wider mb-1">Memory Hits</div>
                    <div className="text-2xl font-bold text-cyan-300">{observabilityData.memoryHitRate?.toFixed(0)}%</div>
                    <div className="text-[9px] text-[#5b6a92] mt-1">missions using memory</div>
                  </div>
                  <div className="rounded-xl glass border border-amber-400/20 p-4">
                    <div className="text-[9px] text-[#5b6a92] uppercase tracking-wider mb-1">Average Confidence</div>
                    <div className="text-2xl font-bold text-amber-300">{observabilityData.averageConfidence?.toFixed(0)}%</div>
                    <div className="text-[9px] text-[#5b6a92] mt-1">across all missions</div>
                  </div>
                  <div className="rounded-xl glass border border-orange-400/20 p-4">
                    <div className="text-[9px] text-[#5b6a92] uppercase tracking-wider mb-1">Executive Corrections</div>
                    <div className="text-2xl font-bold text-orange-300">{observabilityData.executiveCorrectionRate?.toFixed(0)}%</div>
                    <div className="text-[9px] text-[#5b6a92] mt-1">responses rewritten</div>
                  </div>
                  <div className="rounded-xl glass border border-cyan-400/20 p-4">
                    <div className="text-[9px] text-[#5b6a92] uppercase tracking-wider mb-1">Total Cost</div>
                    <div className="text-2xl font-bold text-cyan-300">${observabilityData.totalCost?.toFixed(4)}</div>
                    <div className="text-[9px] text-[#5b6a92] mt-1">{observabilityData.totalTokensUsed || 0} tokens</div>
                  </div>
                </div>

                {/* Top Leaders */}
                {observabilityData.topLeaders?.length > 0 && (
                  <div className="rounded-xl glass border border-cyan-400/10 p-4">
                    <h3 className="text-xs font-bold text-[#e0e7ff] mb-3">Top Leaders (by missions)</h3>
                    <div className="space-y-1.5">
                      {observabilityData.topLeaders.map((l: any, i: number) => (
                        <div key={i} className="flex items-center justify-between text-[11px]">
                          <span className="text-[#9bb5d4]">{l.leader}</span>
                          <span className="text-cyan-300 font-mono">{l.missions} missions</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Top Tools */}
                {observabilityData.topTools?.length > 0 && (
                  <div className="rounded-xl glass border border-cyan-400/10 p-4">
                    <h3 className="text-xs font-bold text-[#e0e7ff] mb-3">Top Tools (by calls)</h3>
                    <div className="space-y-1.5">
                      {observabilityData.topTools.map((t: any, i: number) => (
                        <div key={i} className="flex items-center justify-between text-[11px]">
                          <span className="text-[#9bb5d4]">{t.tool}</span>
                          <span className="text-cyan-300 font-mono">{t.calls} calls</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── MISSIONS VIEW (original) ── */}
        {activeView === 'missions' && (
          <>
        {/* Loading state */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
          </div>
        ) : missions.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-[#5b6a92] text-xs">No active missions. Create one to get started.</p>
          </div>
        ) : (
          <AnimatePresence>
            {missions.map((m, idx) => {
              const currentIdx = m.chain.findIndex((c) => c.stage === m.currentStage)
              const priorityInfo = PRIORITY_BADGE[m.priority] || PRIORITY_BADGE.medium
              const PriorityIcon = priorityInfo.icon
              const totalRevenuePotential = m.revenueTarget
              return (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className="glass glass-hover rounded-xl p-4 cursor-pointer"
                  onClick={() => openMission(m)}
                >
                  {/* Top row: title + priority + stage badge */}
                  <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-bold text-[#e0e7ff]">{m.title}</h3>
                        <span
                          className="text-[9px] px-1.5 py-0.5 rounded-full font-bold flex items-center gap-1"
                          style={{
                            background: priorityInfo.bg,
                            color: priorityInfo.text,
                            border: `1px solid ${priorityInfo.text}40`,
                          }}
                        >
                          <PriorityIcon className="w-2.5 h-2.5" />
                          {m.priority.toUpperCase()}
                        </span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-cyan-400/10 border border-cyan-400/30 text-cyan-200 font-bold">
                          {m.category}
                        </span>
                      </div>
                      <div className="text-[11px] text-[#9bb5d4] mt-0.5 line-clamp-1">{m.description}</div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="text-right">
                        <div className="text-[9px] text-[#5b6a92] tracking-wider uppercase">Target</div>
                        <div className="text-sm font-bold text-emerald-300">${m.revenueTarget}/mo</div>
                      </div>
                      <div
                        className="text-[10px] px-2 py-1 rounded-full font-bold"
                        style={{
                          background: `${STAGE_COLORS[m.currentStage] || '#5b6a92'}20`,
                          color: STAGE_COLORS[m.currentStage] || '#5b6a92',
                          border: `1px solid ${STAGE_COLORS[m.currentStage] || '#5b6a92'}40`,
                        }}
                      >
                        {m.currentStage.replace(/_/g, ' ')}
                      </div>
                    </div>
                  </div>

                  {/* Chain mini-map: Team A → Team B → Team C */}
                  <div className="flex items-center gap-1 overflow-x-auto scroll-cyan pb-1">
                    {m.chain.map((handoff, hIdx) => {
                      const Icon = POD_ICONS[handoff.team] || SettingsIcon
                      const color = POD_COLORS[handoff.team] || '#7c89b5'
                      const isPast = hIdx < currentIdx
                      const isActive = hIdx === currentIdx
                      return (
                        <div key={hIdx} className="flex items-center flex-shrink-0">
                          <div
                            className="flex items-center gap-1.5 px-2 py-1 rounded-lg"
                            style={{
                              background: isActive ? `${color}20` : isPast ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.02)',
                              border: `1px solid ${isActive ? `${color}60` : isPast ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.06)'}`,
                            }}
                          >
                            <Icon
                              className="w-3 h-3"
                              style={{ color: isActive ? color : isPast ? '#22c55e' : '#5b6a92' }}
                            />
                            <span
                              className="text-[10px] font-bold whitespace-nowrap"
                              style={{ color: isActive ? color : isPast ? '#22c55e' : '#5b6a92' }}
                            >
                              {handoff.leader}
                            </span>
                            {isActive && (
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                            )}
                          </div>
                          {hIdx < m.chain.length - 1 && (
                            <ChevronRight
                              className="w-3 h-3 mx-0.5"
                              style={{ color: hIdx < currentIdx ? '#22c55e' : '#2a3450' }}
                            />
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {/* Footer meta */}
                  <div className="flex items-center justify-between mt-2 text-[10px] text-[#5b6a92]">
                    <span>Updated {relativeTime(m.updatedAt)}</span>
                    <span className="text-cyan-300 font-bold">Click to open →</span>
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>
        )}

        {/* Create modal */}
        <AnimatePresence>
          {showCreate && (
            <CreateMissionModal
              onClose={() => setShowCreate(false)}
              onCreated={(m) => {
                setShowCreate(false)
                loadMissions()
                openMission(m)
              }}
            />
          )}
        </AnimatePresence>
          </>
        )}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────
// Create Mission Modal
// ──────────────────────────────────────────────────────────────────
function CreateMissionModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (m: ActiveMission) => void
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [revenueTarget, setRevenueTarget] = useState('')
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'critical'>('medium')
  const [category, setCategory] = useState('Affiliate')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  const create = async () => {
    if (!title.trim() || !description.trim()) {
      setError('Title and description are required')
      return
    }
    setCreating(true)
    setError('')
    try {
      const res = await fetch('/api/mission-active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          revenueTarget: Number(revenueTarget) || 0,
          priority,
          category,
        }),
      })
      const data = await res.json()
      if (data.ok && data.mission) {
        onCreated(data.mission)
      } else {
        setError(data.error || 'Failed to create mission')
      }
    } catch (e: any) {
      setError(e?.message || 'Network error')
    } finally {
      setCreating(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, y: 10 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 10 }}
        onClick={(e) => e.stopPropagation()}
        className="glass-strong rounded-2xl p-6 w-full max-w-lg"
        style={{ borderColor: 'rgba(0,240,255,0.3)' }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold neon-text-cyan">Launch New Mission</h2>
          <button onClick={onClose} className="text-[#7c89b5] hover:text-cyan-300">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-[10px] text-[#7c89b5] tracking-wider uppercase font-bold">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Affiliate Blog Network — AI Tools Niche"
              className="w-full mt-1 bg-black/30 border border-cyan-400/20 rounded-lg px-3 py-2 text-xs text-[#e0e7ff] placeholder:text-[#5b6a92] focus:outline-none focus:border-cyan-400/60"
            />
          </div>
          <div>
            <label className="text-[10px] text-[#7c89b5] tracking-wider uppercase font-bold">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What should the team build/deliver? What's the outcome?"
              rows={3}
              className="w-full mt-1 bg-black/30 border border-cyan-400/20 rounded-lg px-3 py-2 text-xs text-[#e0e7ff] placeholder:text-[#5b6a92] focus:outline-none focus:border-cyan-400/60 resize-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-[#7c89b5] tracking-wider uppercase font-bold">Target $/mo</label>
              <input
                type="number"
                value={revenueTarget}
                onChange={(e) => setRevenueTarget(e.target.value)}
                placeholder="5000"
                className="w-full mt-1 bg-black/30 border border-cyan-400/20 rounded-lg px-3 py-2 text-xs text-[#e0e7ff] placeholder:text-[#5b6a92] focus:outline-none focus:border-cyan-400/60"
              />
            </div>
            <div>
              <label className="text-[10px] text-[#7c89b5] tracking-wider uppercase font-bold">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as any)}
                className="w-full mt-1 bg-black/30 border border-cyan-400/20 rounded-lg px-3 py-2 text-xs text-[#e0e7ff] focus:outline-none focus:border-cyan-400/60"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-[10px] text-[#7c89b5] tracking-wider uppercase font-bold">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full mt-1 bg-black/30 border border-cyan-400/20 rounded-lg px-3 py-2 text-xs text-[#e0e7ff] focus:outline-none focus:border-cyan-400/60"
            >
              <option>Affiliate</option>
              <option>SaaS</option>
              <option>Content</option>
              <option>Trading</option>
              <option>Digital Product</option>
              <option>Service</option>
              <option>Other</option>
            </select>
          </div>

          {error && <div className="text-[10px] text-pink-300">{error}</div>}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[#9bb5d4] hover:bg-white/5 transition"
            >
              Cancel
            </button>
            <button
              onClick={create}
              disabled={creating}
              className="px-4 py-1.5 rounded-lg neon-btn-cyan text-xs font-bold flex items-center gap-1.5 disabled:opacity-50"
            >
              {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Launch Mission
            </button>
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-white/5 text-[10px] text-[#5b6a92] leading-relaxed">
          The mission will start at <span className="text-cyan-300 font-bold">PLANNED</span> stage owned by{' '}
          <span className="text-cyan-300 font-bold">SCOUT</span>, then flow through the team chain:
          SCOUT → AURORA → ECHO → FORGE → PULSE → OWNER APPROVAL.
        </div>
      </motion.div>
    </motion.div>
  )
}
