'use client'

/**
 * AutonomyIntelligencePanel — UPGRADE #87
 * ---------------------------------------------------------------
 * A reusable, animated showcase of Agent007's full autonomy stack:
 *   - 5-layer autonomy pyramid (Perception → Cognition → Memory → Action → Self-Regulation)
 *   - Intelligence matrix (Know / How / When / Which)
 *   - 10 awareness signals (live indicators)
 *   - Tool counts, subagent counts, upgrade counts
 *
 * Two display modes:
 *   - mode="full"   → dashboard tab version (large, with live data fetch)
 *   - mode="compact" → login page version (smaller, static numbers, no fetch)
 *
 * The component is purely presentational — it reads counts from props
 * (or fetches /api/system/manifest in full mode) and renders animated
 * cards with framer-motion.
 */

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Brain,
  Cpu,
  Database,
  Zap,
  Shield,
  Activity,
  Eye,
  Network,
  Gauge,
  Wrench,
  Users,
  Sparkles,
  TrendingUp,
  Lock,
  RefreshCw,
  Target,
} from 'lucide-react'

interface Props {
  mode?: 'full' | 'compact'
  className?: string
}

interface ManifestData {
  totalUpgrades: number
  totalTools: number
  totalSubagents: number
  totalProviders: number
}

const STATIC_COUNTS: ManifestData = {
  totalUpgrades: 82,
  totalTools: 612,
  totalSubagents: 20,
  totalProviders: 5,
}

const AUTONOMY_LAYERS = [
  {
    id: 1,
    name: 'Perception',
    icon: Eye,
    color: 'cyan',
    desc: '391+ tools • 27 AI providers • 12 AI search engines • web/page/URL/file/code readers',
  },
  {
    id: 2,
    name: 'Cognition',
    icon: Brain,
    color: 'purple',
    desc: '5-provider LLM router (OpenAI→z-ai→Gemini→Groq→OpenRouter) • 14 fallback attempts • 4-step thought framework',
  },
  {
    id: 3,
    name: 'Memory',
    icon: Database,
    color: 'emerald',
    desc: 'Persistent Postgres DB • memory_store/recall • conversation anchor • anti-amnesia injection',
  },
  {
    id: 4,
    name: 'Action',
    icon: Zap,
    color: 'pink',
    desc: '20 subagents (all FULL_ACCESS) • parallel_executor (5 simultaneous) • multi-dispatch • cap at 3',
  },
  {
    id: 5,
    name: 'Self-Regulation',
    icon: Shield,
    color: 'amber',
    desc: '8 MAX autonomy tools • auto-recovery (stuck/promise detection) • tool diversity enforcer • heartbeat',
  },
]

const INTELLIGENCE_MATRIX = [
  {
    label: 'KNOW',
    icon: Brain,
    color: '#00f0ff',
    items: ['391+ tools', '20 subagents', '82 upgrades', '5 LLM providers', '12 AI search engines', '27 provider integrations'],
  },
  {
    label: 'HOW',
    icon: Cpu,
    color: '#a855f7',
    items: ['Parallel execution (3x speed)', 'Smart tool routing', 'Accuracy verification', 'Self-learning memory', 'Self-repair engine'],
  },
  {
    label: 'WHEN',
    icon: Network,
    color: '#10b981',
    items: ['Income→aurora/vertex/quantum', 'Implementation→forge/quill/prism', 'Analysis→pulse/echo', 'Research→scout/hunt', 'Legal→legal/banker'],
  },
  {
    label: 'WHICH',
    icon: Gauge,
    color: '#ec4899',
    items: ['smart_tool_router picks best tool', 'parallel_executor batches calls', 'decision_matrix for revenue', 'accuracy_checker for facts', 'tool_diversity_enforcer'],
  },
]

const AWARENESS_SIGNALS = [
  { label: 'Heartbeat', icon: Activity, color: '#00f0ff' },
  { label: 'Subagent Activity', icon: Users, color: '#a855f7' },
  { label: 'Tool Diversity', icon: Wrench, color: '#10b981' },
  { label: 'Stuck Detection', icon: RefreshCw, color: '#ec4899' },
  { label: 'Multi-Device Sync', icon: Network, color: '#f59e0b' },
  { label: 'Auto-Refresh (15s)', icon: RefreshCw, color: '#06b6d4' },
  { label: 'LLM Provider Chain', icon: Cpu, color: '#8b5cf6' },
  { label: 'Memory Recall', icon: Database, color: '#22c55e' },
  { label: 'Income Auto-Log', icon: TrendingUp, color: '#f43f5e' },
  { label: 'Mission Tracking', icon: Target, color: '#eab308' },
]

// missing import — add Target to the import list above

function StatCard({ icon: Icon, label, value, color, size = 'md' }: {
  icon: any
  label: string
  value: string | number
  color: string
  size?: 'sm' | 'md'
}) {
  const pad = size === 'sm' ? 'p-2.5' : 'p-3.5'
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={`${pad} rounded-xl glass border border-white/10 flex items-center gap-2.5`}
      style={{ boxShadow: `0 0 16px ${color}22` }}
    >
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: `${color}1f`, border: `1px solid ${color}55` }}
      >
        <Icon className="w-4 h-4" style={{ color }} />
      </div>
      <div className="min-w-0">
        <div className="text-base font-bold text-white leading-tight">{value}</div>
        <div className="text-[10px] tracking-wider text-[#7c89b5] uppercase truncate">{label}</div>
      </div>
    </motion.div>
  )
}

export function AutonomyIntelligencePanel({ mode = 'full', className = '' }: Props) {
  const [data, setData] = useState<ManifestData>(STATIC_COUNTS)
  const [loading, setLoading] = useState(mode === 'full')

  useEffect(() => {
    if (mode !== 'full') return
    let cancelled = false
    fetch('/api/system/manifest')
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return
        setData({
          totalUpgrades: j.totalUpgrades ?? STATIC_COUNTS.totalUpgrades,
          totalTools: j.totalTools ?? STATIC_COUNTS.totalTools,
          totalSubagents: j.totalSubagents ?? STATIC_COUNTS.totalSubagents,
          totalProviders: 5,
        })
        setLoading(false)
      })
      .catch(() => setLoading(false))
    return () => { cancelled = true }
  }, [mode])

  const isCompact = mode === 'compact'

  return (
    <div className={className}>
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-2 mb-4"
      >
        <Sparkles className="w-4 h-4 text-cyan-300" />
        <h3 className={`font-bold tracking-wide ${isCompact ? 'text-sm' : 'text-base'} text-[#e0e7ff]`}>
          AUTONOMY • INTELLIGENCE • AWARENESS
        </h3>
        <div className="flex-1 h-px bg-gradient-to-r from-cyan-400/40 to-transparent" />
        <span className="text-[10px] text-cyan-300/80 tracking-wider font-mono">v2.0</span>
      </motion.div>

      {/* Stat cards row */}
      <div className={`grid grid-cols-2 ${isCompact ? 'sm:grid-cols-4 gap-2' : 'sm:grid-cols-4 gap-3'} mb-5`}>
        <StatCard icon={Wrench} label="Tools" value={loading ? '…' : data.totalTools} color="#00f0ff" size={isCompact ? 'sm' : 'md'} />
        <StatCard icon={Users} label="Subagents" value={loading ? '…' : data.totalSubagents} color="#a855f7" size={isCompact ? 'sm' : 'md'} />
        <StatCard icon={Lock} label="Upgrades" value={loading ? '…' : data.totalUpgrades} color="#10b981" size={isCompact ? 'sm' : 'md'} />
        <StatCard icon={Cpu} label="LLM Providers" value={data.totalProviders} color="#ec4899" size={isCompact ? 'sm' : 'md'} />
      </div>

      {/* 5-Layer Autonomy Pyramid */}
      <div className="mb-5">
        <div className="flex items-center gap-1.5 mb-2.5">
          <Shield className="w-3.5 h-3.5 text-cyan-300" />
          <span className="text-[11px] tracking-[0.2em] text-[#7c89b5] font-semibold uppercase">5-Layer Autonomy Stack</span>
        </div>
        <div className="space-y-1.5">
          {AUTONOMY_LAYERS.map((layer, i) => {
            const Icon = layer.icon
            const widthPct = 100 - i * 8  // tapered pyramid effect
            return (
              <motion.div
                key={layer.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.08, duration: 0.35 }}
                style={{ width: `${widthPct}%`, marginLeft: `${(100 - widthPct) / 2}%` }}
                className={`flex items-center gap-2.5 ${isCompact ? 'p-2' : 'p-2.5'} rounded-lg glass border border-white/10`}
              >
                <div
                  className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0"
                  style={{
                    background: `${layer.color === 'cyan' ? '#00f0ff' : layer.color === 'purple' ? '#a855f7' : layer.color === 'emerald' ? '#10b981' : layer.color === 'pink' ? '#ec4899' : '#f59e0b'}1f`,
                    border: `1px solid ${layer.color === 'cyan' ? '#00f0ff' : layer.color === 'purple' ? '#a855f7' : layer.color === 'emerald' ? '#10b981' : layer.color === 'pink' ? '#ec4899' : '#f59e0b'}55`,
                  }}
                >
                  <Icon
                    className="w-3.5 h-3.5"
                    style={{
                      color: layer.color === 'cyan' ? '#00f0ff' : layer.color === 'purple' ? '#a855f7' : layer.color === 'emerald' ? '#10b981' : layer.color === 'pink' ? '#ec4899' : '#f59e0b',
                    }}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[10px] text-[#7c89b5] font-mono">L{layer.id}</span>
                    <span className="text-xs font-bold text-[#e0e7ff]">{layer.name}</span>
                  </div>
                  {!isCompact && (
                    <div className="text-[10px] text-[#7c89b5] mt-0.5 truncate">{layer.desc}</div>
                  )}
                </div>
              </motion.div>
            )
          })}
        </div>
      </div>

      {/* Intelligence Matrix — Know / How / When / Which */}
      {!isCompact && (
        <div className="mb-5">
          <div className="flex items-center gap-1.5 mb-2.5">
            <Brain className="w-3.5 h-3.5 text-purple-300" />
            <span className="text-[11px] tracking-[0.2em] text-[#7c89b5] font-semibold uppercase">Intelligence Matrix</span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {INTELLIGENCE_MATRIX.map((m, i) => {
              const Icon = m.icon
              return (
                <motion.div
                  key={m.label}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1, duration: 0.35 }}
                  className="rounded-lg glass border border-white/10 p-2.5"
                >
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Icon className="w-3.5 h-3.5" style={{ color: m.color }} />
                    <span className="text-[11px] font-bold tracking-wider" style={{ color: m.color }}>{m.label}</span>
                  </div>
                  <ul className="space-y-1">
                    {m.items.map((item, idx) => (
                      <li key={idx} className="text-[10px] text-[#cfd9f0] leading-tight flex items-start gap-1">
                        <span style={{ color: m.color }}>•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </motion.div>
              )
            })}
          </div>
        </div>
      )}

      {/* Awareness signals */}
      <div>
        <div className="flex items-center gap-1.5 mb-2.5">
          <Activity className="w-3.5 h-3.5 text-emerald-300" />
          <span className="text-[11px] tracking-[0.2em] text-[#7c89b5] font-semibold uppercase">10 Awareness Signals</span>
        </div>
        <div className={`flex flex-wrap gap-1.5 ${isCompact ? '' : ''}`}>
          {AWARENESS_SIGNALS.map((sig, i) => {
            const Icon = sig.icon
            return (
              <motion.div
                key={sig.label}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.05, duration: 0.3 }}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md glass border border-white/10"
                style={{ boxShadow: `0 0 8px ${sig.color}22` }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full animate-pulse"
                  style={{ background: sig.color, boxShadow: `0 0 6px ${sig.color}` }}
                />
                <Icon className="w-3 h-3" style={{ color: sig.color }} />
                <span className="text-[10px] text-[#cfd9f0] font-medium">{sig.label}</span>
              </motion.div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
