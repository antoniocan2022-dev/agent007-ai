'use client'

import { motion } from 'framer-motion'
import { Sparkles, Globe, Zap } from 'lucide-react'
import { NexusLogo } from './nexus-logo'

const SUGGESTIONS = [
  {
    icon: 'lightbulb',
    title: 'Side-hustle ideas',
    text: 'Pitch me 3 side-hustle ideas for a developer that can reach $2k/mo in 90 days',
  },
  {
    icon: 'search',
    title: 'Market research',
    text: 'Research the current market for AI consulting: rates, niches, and demand in 2025',
  },
  {
    icon: 'palette',
    title: 'Logo concept',
    text: 'Generate a logo concept for a specialty coffee brand called "Aurora Roasters"',
  },
  {
    icon: 'chart',
    title: 'Analyze my data',
    text: 'Run code to compute: monthly recurring revenue given 100 customers at $29 with 3% monthly churn',
  },
]

const ICONS: Record<string, any> = {
  lightbulb: Sparkles,
  search: Globe,
  palette: Zap,
  chart: Zap,
}

export function EmptyState({ onPick }: { onPick: (text: string) => void }) {
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
        <span className="neon-text-cyan">NEXUS</span>{' '}
        <span className="neon-text-purple">AI</span>
      </motion.h1>
      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25, duration: 0.6 }}
        className="mt-3 text-sm sm:text-base text-[#7c89b5] tracking-wide"
      >
        Your AI Super Agent — <span className="text-[#e0e7ff]">Built to Learn.</span>{' '}
        <span className="text-[#e0e7ff]">Built to Earn.</span>
      </motion.p>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, duration: 0.6 }}
        className="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 w-full max-w-2xl"
      >
        {SUGGESTIONS.map((s, i) => {
          const Icon = ICONS[s.icon] ?? Sparkles
          return (
            <button
              key={i}
              onClick={() => onPick(s.text)}
              className="glass glass-hover rounded-xl p-4 text-left group"
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 w-9 h-9 rounded-lg flex items-center justify-center bg-cyan-400/10 border border-cyan-400/30 text-cyan-300 group-hover:scale-110 transition-transform">
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs label-tag mb-0.5">{s.title}</div>
                  <div className="text-sm text-[#e0e7ff]/90 leading-snug">{s.text}</div>
                </div>
              </div>
            </button>
          )
        })}
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6, duration: 0.8 }}
        className="mt-10 flex flex-wrap items-center justify-center gap-2 text-xs text-[#7c89b5]"
      >
        {[
          'Web Search',
          'Image Gen',
          'Vision',
          'Code Exec',
          'File Handling',
          'Memory',
          'Bilingual',
        ].map((c) => (
          <span
            key={c}
            className="px-2.5 py-1 rounded-full bg-cyan-400/5 border border-cyan-400/15 text-[#9bb5d4]"
          >
            {c}
          </span>
        ))}
      </motion.div>
    </div>
  )
}
