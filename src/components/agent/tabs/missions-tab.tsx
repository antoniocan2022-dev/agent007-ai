'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Rocket, TrendingUp, Briefcase, DollarSign, Shield, Repeat, Play, Clock, Users } from 'lucide-react'
import { MISSION_TEMPLATES, type MissionTemplate } from '@/lib/mission-templates'
import { useChatStore } from '@/store/chat-store'

const ICONS: Record<string, any> = {
  Rocket,
  TrendingUp,
  Briefcase,
  DollarSign,
  Shield,
  Repeat,
}

export function MissionsTab() {
  const [selected, setSelected] = useState<MissionTemplate | null>(null)
  const setActiveTab = useChatStore((s) => s.setActiveTab)
  const sendMessage = useChatStore((s) => s.sendMessage)

  const launchMission = async (template: MissionTemplate) => {
    setSelected(null)
    // Switch to chat tab and send the mission prompt
    setActiveTab('chat')
    // Small delay to let the tab switch render
    setTimeout(() => {
      sendMessage(template.prompt)
    }, 300)
  }

  return (
    <div className="flex-1 overflow-y-auto scroll-cyan px-4 sm:px-6 py-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6"
        >
          <h2 className="text-2xl font-bold neon-text-cyan mb-1">Mission Templates</h2>
          <p className="text-sm text-[#7c89b5]">
            Pre-built multi-agent workflows. One click launches a coordinated sequence of sub-agent dispatches.
          </p>
        </motion.div>

        {/* Mission grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {MISSION_TEMPLATES.map((template, i) => {
            const Icon = ICONS[template.icon] || Rocket
            return (
              <motion.div
                key={template.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08, duration: 0.4 }}
                className="glass glass-hover rounded-xl p-5 flex flex-col group cursor-pointer"
                onClick={() => setSelected(template)}
              >
                {/* Icon + name */}
                <div className="flex items-start gap-3 mb-3">
                  <div
                    className="w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{
                      background: `${template.color}15`,
                      border: `1px solid ${template.color}40`,
                      color: template.color,
                    }}
                  >
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-bold text-[#e0e7ff] leading-tight">
                      {template.name}
                    </h3>
                    <div className="text-[10px] text-[#7c89b5] mt-0.5 font-mono">
                      {template.tagline}
                    </div>
                  </div>
                </div>

                {/* Description */}
                <p className="text-xs text-[#9bb5d4] leading-relaxed mb-4 flex-1">
                  {template.description}
                </p>

                {/* Meta */}
                <div className="flex items-center gap-3 text-[10px] text-[#5b6a92] mb-3">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    ~{template.estimatedMinutes}m
                  </span>
                  <span className="flex items-center gap-1">
                    <Users className="w-3 h-3" />
                    {template.agentsUsed.length} agents
                  </span>
                </div>

                {/* Launch button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    launchMission(template)
                  }}
                  className="w-full neon-btn-cyan rounded-lg py-2 text-xs font-bold tracking-wider flex items-center justify-center gap-2"
                  style={{ touchAction: 'manipulation' }}
                >
                  <Play className="w-3.5 h-3.5" fill="currentColor" />
                  LAUNCH MISSION
                </button>
              </motion.div>
            )
          })}
        </div>

        {/* Info banner */}
        <div className="mt-8 glass rounded-xl p-4 border-cyan-400/20">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-cyan-400/10 border border-cyan-400/30 flex items-center justify-center flex-shrink-0">
              <span className="text-cyan-300 text-sm">💡</span>
            </div>
            <div className="text-xs text-[#9bb5d4] leading-relaxed">
              <strong className="text-[#e0e7ff]">How missions work:</strong> Clicking LAUNCH MISSION
              switches to the Chat tab and sends a detailed multi-step prompt to Agent007. The Super
              Agent will then dispatch the listed sub-agents in sequence, collecting each one's
              research/output before moving to the next. The full reasoning trace appears in the
              timeline. You can customize the generated conversation afterward.
            </div>
          </div>
        </div>
      </div>

      {/* Detail modal */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4"
          onClick={() => setSelected(null)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-2xl glass-strong sm:rounded-2xl p-6 max-h-screen sm:max-h-[90vh] overflow-y-auto scroll-cyan"
            style={{ borderColor: `${selected.color}40` }}
          >
            <div className="flex items-start gap-3 mb-4">
              <div
                className="w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: `${selected.color}15`, border: `1px solid ${selected.color}40`, color: selected.color }}
              >
                {(() => {
                  const Icon = ICONS[selected.icon] || Rocket
                  return <Icon className="w-6 h-6" />
                })()}
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-bold text-[#e0e7ff]">{selected.name}</h2>
                <div className="text-xs font-mono" style={{ color: selected.color }}>
                  {selected.tagline}
                </div>
              </div>
            </div>

            <p className="text-sm text-[#9bb5d4] leading-relaxed mb-4">{selected.description}</p>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="glass rounded-lg p-3">
                <div className="text-[10px] label-tag mb-1">ESTIMATED TIME</div>
                <div className="text-sm font-bold text-[#e0e7ff]">~{selected.estimatedMinutes} min</div>
              </div>
              <div className="glass rounded-lg p-3">
                <div className="text-[10px] label-tag mb-1">AGENTS USED</div>
                <div className="text-sm font-bold text-[#e0e7ff]">{selected.agentsUsed.length} sub-agents</div>
              </div>
            </div>

            <div className="mb-4">
              <div className="text-[10px] label-tag mb-2">AGENTS SEQUENCE</div>
              <div className="flex flex-wrap gap-1.5">
                {selected.agentsUsed.map((agent, i) => (
                  <span
                    key={i}
                    className="px-2 py-1 rounded-md text-[10px] font-semibold glass border-cyan-400/20 text-[#9bb5d4]"
                  >
                    {i + 1}. {agent}
                  </span>
                ))}
              </div>
            </div>

            <div className="mb-4">
              <div className="text-[10px] label-tag mb-2">PROMPT PREVIEW</div>
              <pre className="text-[11px] text-[#9bb5d4] bg-black/40 border border-cyan-400/10 rounded-lg p-3 max-h-40 overflow-y-auto scroll-cyan whitespace-pre-wrap">
                {selected.prompt.slice(0, 500)}...
              </pre>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => setSelected(null)}
                className="flex-1 px-4 py-2 rounded-lg text-xs font-semibold glass border-cyan-400/20 text-[#cfd9f0] hover:border-cyan-400/40 transition"
                style={{ touchAction: 'manipulation' }}
              >
                Cancel
              </button>
              <button
                onClick={() => launchMission(selected)}
                className="flex-1 neon-btn-cyan rounded-lg py-2 text-xs font-bold tracking-wider flex items-center justify-center gap-2"
                style={{ touchAction: 'manipulation' }}
              >
                <Play className="w-3.5 h-3.5" fill="currentColor" />
                LAUNCH MISSION
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  )
}
