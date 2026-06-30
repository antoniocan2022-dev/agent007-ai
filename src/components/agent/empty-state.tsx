'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Sparkles,
  Box,
  TrendingUp,
  Search,
  Crosshair,
  Hammer,
  PenLine,
  Palette,
  Activity,
  RefreshCw,
  Scale,
  Landmark,
  Lightbulb,
  Target,
  type LucideIcon,
} from 'lucide-react'
import { NexusLogo } from './nexus-logo'
import { useChatStore } from '@/store/chat-store'

/* Sub-agent accent colors (mirror of /src/lib/subagents.ts) */
const SUBAGENT_COLORS: Record<string, string> = {
  aurora: '#00f0ff',
  vertex: '#34d399',
  quantum: '#fbbf24',
  scout: '#38bdf8',
  hunt: '#a78bfa',
  forge: '#fb923c',
  quill: '#f472b6',
  prism: '#e879f9',
  pulse: '#fb7185',
  echo: '#818cf8',
  legal: '#22d3ee',
  banker: '#10b981',
}

const SUGGESTIONS = [
  {
    icon: 'pulse',
    title: 'Passive income plan',
    text: "Build me a passive income plan targeting +10% daily growth",
  },
  {
    icon: 'scout',
    title: 'Opportunity scan',
    text: 'Use Scout + Hunt to find 3 income opportunities I can start today',
  },
  {
    icon: 'prism',
    title: 'Brand design',
    text: 'Have Prism design a brand for my new digital product',
  },
  {
    icon: 'pulse',
    title: 'KPI dashboard',
    text: 'Set up KPIs with Pulse to track my daily income growth',
  },
]

const SUGGESTION_ICONS: Record<string, LucideIcon> = {
  scout: Search,
  hunt: Crosshair,
  prism: Palette,
  pulse: Activity,
}

export function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  const [localCount, setLocalCount] = useState(12)

  // Developer agent's fix: fetch on mount to get the real count.
  useEffect(() => {
    fetch('/api/subagents')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.subagents)) {
          setLocalCount(data.subagents.length)
        }
      })
      .catch(() => {})
  }, [])

  const subagentCount = localCount

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] px-4 py-10 text-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.7, ease: 'easeOut' }}
        className="hex-pulse mb-6"
      >
        <NexusLogo size={96} />
      </motion.div>

      <motion.h1
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.6 }}
        className="text-3xl sm:text-4xl font-extrabold tracking-tight"
      >
        <span className="neon-text-cyan">Agent007</span>{' '}
        <span className="neon-text-purple">AI</span>
      </motion.h1>
      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25, duration: 0.6 }}
        className="mt-3 text-sm sm:text-base text-[#7c89b5] tracking-wide"
      >
        Your AI Income Operator —{' '}
        <span className="text-[#e0e7ff]">12 Specialists.</span>{' '}
        <span className="text-[#e0e7ff]">One Mission: +10% Daily.</span>
      </motion.p>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, duration: 0.6 }}
        className="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 w-full max-w-2xl"
      >
        {SUGGESTIONS.map((s, i) => {
          const Icon = SUGGESTION_ICONS[s.icon] ?? Sparkles
          const color = SUBAGENT_COLORS[s.icon] ?? '#00f0ff'
          return (
            <button
              key={i}
              onClick={() => onPick(s.text)}
              className="glass glass-hover rounded-xl p-4 text-left group"
              style={{ borderColor: `${color}25`, borderWidth: 1, borderStyle: 'solid' }}
            >
              <div className="flex items-start gap-3">
                <div
                  className="mt-0.5 w-9 h-9 rounded-lg flex items-center justify-center border group-hover:scale-110 transition-transform"
                  style={{
                    background: `${color}12`,
                    borderColor: `${color}50`,
                  }}
                >
                  <Icon className="w-4 h-4" style={{ color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div
                    className="text-xs label-tag mb-0.5"
                    style={{ color }}
                  >
                    {s.title}
                  </div>
                  <div className="text-sm text-[#e0e7ff]/90 leading-snug">{s.text}</div>
                </div>
              </div>
            </button>
          )
        })}
      </motion.div>

      {/* sub-agent chips */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.55, duration: 0.8 }}
        className="mt-8 w-full max-w-2xl"
      >
        <div className="text-[9px] tracking-[0.25em] text-[#5b6a92] mb-3">{subagentCount} SUB-AGENTS AT YOUR COMMAND</div>
        <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
          {Object.entries(SUBAGENT_COLORS).map(([id, color]) => {
            const Icon = SUBAGENT_ICON_MAP[id] ?? Sparkles
            return (
              <span
                key={id}
                className="px-2.5 py-1 rounded-full border inline-flex items-center gap-1 capitalize text-[10px] font-semibold tracking-wider"
                style={{
                  color,
                  borderColor: `${color}40`,
                  background: `${color}08`,
                }}
              >
                <Icon className="w-3 h-3" style={{ color }} />
                {id}
              </span>
            )
          })}
        </div>
      </motion.div>

      {/* capability chips */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.7, duration: 0.8 }}
        className="mt-6 flex flex-wrap items-center justify-center gap-2 text-xs text-[#7c89b5]"
      >
        {[
          { icon: Target, label: '+10% Daily Mission' },
          { icon: Sparkles, label: `${subagentCount} Sub-Agents` },
          { icon: Search, label: 'Full Internet Access' },
          { icon: Lightbulb, label: 'Self-Learning' },
        ].map((c) => {
          const Icon = c.icon
          return (
            <span
              key={c.label}
              className="px-2.5 py-1 rounded-full bg-cyan-400/5 border border-cyan-400/15 text-[#9bb5d4] inline-flex items-center gap-1.5"
            >
              <Icon className="w-3 h-3 text-cyan-300" />
              {c.label}
            </span>
          )
        })}
      </motion.div>
    </div>
  )
}

const SUBAGENT_ICON_MAP: Record<string, LucideIcon> = {
  aurora: Sparkles,
  vertex: Box,
  quantum: TrendingUp,
  scout: Search,
  hunt: Crosshair,
  forge: Hammer,
  quill: PenLine,
  prism: Palette,
  pulse: Activity,
  echo: RefreshCw,
  legal: Scale,
  banker: Landmark,
}
