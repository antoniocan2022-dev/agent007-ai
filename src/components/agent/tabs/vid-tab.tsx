'use client'

/**
 * ─────────────────────────────────────────────────────────────────────────
 * VID Tab — Venture Intelligence Division
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The 2nd most powerful department in the organization (after the CEO).
 * Reports directly to the CEO. Owns venture creation, Venture Score ≥ 87,
 * portfolio management, and Knowledge Transfer Rate.
 *
 * Sections:
 *   1. Header banner (rank, reports-to)
 *   2. Org hierarchy accordions: 1 Leader · 8 Members · 4 Specialists
 *   3. Leader profile (full personality + responsibilities + KPIs)
 *   4. 8 Permanent Members grid (full tool domains + real tools)
 *   5. Chief Venture Scientist (experiments)
 *   6. 4 Specialists (Legal · Financial · Brand · Technical)
 *   7. Organizational Rules (NEVER list)
 *   8. Venture Score table (87 threshold)
 *   9. 13-Step Workflow with REAL example data
 *  10. Division KPIs
 *  11. Knowledge Transfer Rate banner
 */

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronDown,
  Crown,
  Brain,
  Skull,
  Sparkles,
  XCircle,
  CheckCircle2,
  ArrowRight,
  AlertTriangle,
  Cpu,
  Activity,
  TrendingUp,
  Send,
  X,
  Loader2,
  Target,
} from 'lucide-react'
import {
  VID_MISSION,
  VID_ORG_RULES_NEVER,
  VENTURE_SCORE_CATEGORIES,
  VENTURE_SCORE_THRESHOLD,
  VID_WORKFLOW_STAGES,
  VID_KPIS,
  VID_LEADER,
  VID_MEMBERS,
  CHIEF_VENTURE_SCIENTIST,
  VID_SPECIALISTS,
  VID_ORG_SECTIONS,
  KNOWLEDGE_TRANSFER_RATE_BANNER,
} from '@/lib/vid-data'

// ──────────────────────────────────────────────────────────────────
// Sub-component: section accordion (used for the 3 org sections)
// ──────────────────────────────────────────────────────────────────

function OrgSectionAccordion({
  section,
  defaultOpen = false,
  children,
}: {
  section: { id: string; label: string; count: number; icon: any; color: string; description: string }
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const Icon = section.icon
  return (
    <div
      className="glass rounded-xl overflow-hidden border"
      style={{ borderColor: `${section.color}40` }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 p-3.5 text-left transition hover:bg-white/[0.02]"
        aria-expanded={open}
      >
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: `${section.color}15`, border: `1px solid ${section.color}50` }}
        >
          <Icon className="w-5 h-5" style={{ color: section.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-bold" style={{ color: section.color }}>
              {section.label}
            </h3>
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full font-mono"
              style={{ background: `${section.color}15`, color: section.color, border: `1px solid ${section.color}40` }}
            >
              {section.count}
            </span>
          </div>
          <p className="text-[10px] text-[#7c89b5] mt-0.5 leading-snug">{section.description}</p>
        </div>
        <ChevronDown
          className={`w-4 h-4 transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`}
          style={{ color: section.color }}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="p-3.5 pt-0">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────
// Sub-component: Leader profile
// ──────────────────────────────────────────────────────────────────

function LeaderCard() {
  const L = VID_LEADER
  const Icon = L.icon
  return (
    <div
      className="rounded-xl p-4 border relative overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, rgba(0,240,255,0.07), rgba(168,85,247,0.07))',
        borderColor: 'rgba(0,240,255,0.35)',
      }}
    >
      {/* Rank ribbon */}
      <div className="absolute top-0 right-0 px-2 py-0.5 rounded-bl-lg text-[9px] font-mono tracking-wider"
        style={{ background: 'rgba(0,240,255,0.15)', color: '#00f0ff', borderLeft: '1px solid rgba(0,240,255,0.4)', borderBottom: '1px solid rgba(0,240,255,0.4)' }}
      >
        RANK #2 · ONLY BELOW CEO
      </div>

      {/* Header */}
      <div className="flex items-start gap-3 mb-4">
        <div
          className="w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{
            background: 'linear-gradient(135deg, rgba(0,240,255,0.25), rgba(168,85,247,0.25))',
            border: '1px solid rgba(0,240,255,0.6)',
            boxShadow: '0 0 18px rgba(0,240,255,0.35)',
          }}
        >
          <Icon className="w-7 h-7 text-cyan-300" />
        </div>
        <div className="flex-1 min-w-0 pt-1">
          <h3 className="text-lg font-bold neon-text-cyan">{L.name}</h3>
          <p className="text-[11px] text-[#9bb5d4] mt-0.5">{L.tagline}</p>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-cyan-400/10 border border-cyan-400/30 text-cyan-200 font-mono">
              {L.iqRank}
            </span>
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-400/10 border border-purple-400/30 text-purple-200 font-mono">
              REPORTS TO: {L.reportsTo}
            </span>
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-pink-400/10 border border-pink-400/30 text-pink-200 font-mono">
              {L.rank}
            </span>
          </div>
        </div>
      </div>

      {/* Personality grid */}
      <div className="mb-4">
        <div className="text-[10px] uppercase tracking-wider text-[#5b6a92] mb-1.5 font-semibold">
          Personality
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
          {L.personality.map((trait) => (
            <div
              key={trait}
              className="text-[10px] px-2 py-1 rounded-md bg-white/[0.03] border border-cyan-400/15 text-[#cfd9f0] flex items-center gap-1.5"
            >
              <Brain className="w-2.5 h-2.5 text-cyan-300 flex-shrink-0" />
              <span>{trait}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Responsibilities — Never vs Instead */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <div className="rounded-lg p-3 border border-red-500/30 bg-red-500/[0.04]">
          <div className="flex items-center gap-1.5 mb-2">
            <XCircle className="w-3.5 h-3.5 text-red-400" />
            <span className="text-[10px] uppercase tracking-wider text-red-300 font-bold">
              NEVER
            </span>
          </div>
          <ul className="space-y-1">
            {L.responsibilities.never.map((n) => (
              <li key={n} className="text-[11px] text-[#cfd9f0] flex items-start gap-1.5">
                <span className="text-red-400 mt-0.5">✕</span>
                <span>{n}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg p-3 border border-emerald-500/30 bg-emerald-500/[0.04]">
          <div className="flex items-center gap-1.5 mb-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-[10px] uppercase tracking-wider text-emerald-300 font-bold">
              INSTEAD
            </span>
          </div>
          <ul className="space-y-1">
            {L.responsibilities.instead.map((i) => (
              <li key={i} className="text-[11px] text-[#cfd9f0] flex items-start gap-1.5">
                <span className="text-emerald-400 mt-0.5">→</span>
                <span>{i}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* KPIs */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-[#5b6a92] mb-1.5 font-semibold">
          Director KPIs
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
          {L.kpis.map((kpi) => (
            <div
              key={kpi.name}
              className="text-[10px] p-2 rounded-md bg-white/[0.02] border border-purple-400/15"
            >
              <div className="font-semibold text-purple-200">{kpi.name}</div>
              <div className="text-[9px] text-[#7c89b5] mt-0.5 leading-snug">{kpi.description}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────
// Sub-component: Member card (used for the 8 permanent members)
// ──────────────────────────────────────────────────────────────────

function MemberCard({ member }: { member: typeof VID_MEMBERS[number] }) {
  const [expanded, setExpanded] = useState(false)
  const Icon = member.icon
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass rounded-xl overflow-hidden border"
      style={{ borderColor: `${member.color}40` }}
    >
      {/* Header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 p-3 text-left transition hover:bg-white/[0.02]"
      >
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: `${member.color}15`, border: `1px solid ${member.color}50` }}
        >
          <Icon className="w-5 h-5" style={{ color: member.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[9px] font-mono text-[#5b6a92]">{member.role}</span>
            {member.highlight && (
              <span
                className="text-[8px] px-1 py-0.5 rounded-full font-mono"
                style={{ background: `${member.color}20`, color: member.color, border: `1px solid ${member.color}40` }}
              >
                ★ {member.highlight}
              </span>
            )}
          </div>
          <h3 className="text-sm font-bold truncate" style={{ color: member.color }}>
            {member.name}
          </h3>
        </div>
        <ChevronDown
          className={`w-4 h-4 transition-transform flex-shrink-0 ${expanded ? 'rotate-180' : ''}`}
          style={{ color: member.color }}
        />
      </button>

      {/* Always-visible mission */}
      <div className="px-3 pb-2">
        <p className="text-[11px] text-[#a5b4fc] leading-snug">
          <span className="text-[#5b6a92] uppercase text-[9px] tracking-wider mr-1.5">Mission</span>
          {member.mission}
        </p>
      </div>

      {/* Expandable body */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-t"
            style={{ borderColor: `${member.color}25` }}
          >
            <div className="p-3 space-y-3">
              {/* Scope */}
              <div>
                <div className="text-[9px] uppercase tracking-wider text-[#5b6a92] mb-1 font-semibold">
                  Looks at / Studies / Designs
                </div>
                <div className="flex flex-wrap gap-1">
                  {member.scope.map((s) => (
                    <span
                      key={s}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-white/[0.04] border text-[#cfd9f0]"
                      style={{ borderColor: `${member.color}25` }}
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>

              {/* Personality */}
              <div>
                <div className="text-[9px] uppercase tracking-wider text-[#5b6a92] mb-1 font-semibold">
                  Personality
                </div>
                <ul className="space-y-0.5">
                  {member.personality.map((p) => (
                    <li key={p} className="text-[10px] text-[#cfd9f0] flex items-start gap-1.5">
                      <Brain className="w-2.5 h-2.5 flex-shrink-0 mt-0.5" style={{ color: member.color }} />
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Tool Domain */}
              <div>
                <div className="text-[9px] uppercase tracking-wider text-[#5b6a92] mb-1 font-semibold">
                  Tool Domain
                </div>
                <div
                  className="text-[10px] px-2 py-1 rounded-md inline-block"
                  style={{ background: `${member.color}10`, border: `1px solid ${member.color}30`, color: member.color }}
                >
                  {member.toolDomain}
                </div>
              </div>

              {/* Real Tools */}
              <div>
                <div className="text-[9px] uppercase tracking-wider text-[#5b6a92] mb-1 font-semibold flex items-center gap-1">
                  <Cpu className="w-2.5 h-2.5" /> Real Tools ({member.tools.length})
                </div>
                <div className="grid grid-cols-1 gap-1">
                  {member.tools.map((t) => (
                    <div
                      key={t.name}
                      className="text-[9px] font-mono px-2 py-1 rounded bg-black/30 border flex items-center justify-between gap-2"
                      style={{ borderColor: `${member.color}20` }}
                    >
                      <span style={{ color: member.color }}>{t.name}</span>
                      <span className="text-[8px] text-[#5b6a92] truncate">{t.source}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Output */}
              <div
                className="p-2 rounded-md border-l-2 text-[10px]"
                style={{ background: `${member.color}08`, borderLeftColor: member.color }}
              >
                <span className="text-[#5b6a92] uppercase text-[9px] tracking-wider mr-1">Output:</span>
                <span className="text-[#cfd9f0]">{member.output}</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ──────────────────────────────────────────────────────────────────
// Sub-component: Chief Venture Scientist card
// ──────────────────────────────────────────────────────────────────

function ScientistCard() {
  const S = CHIEF_VENTURE_SCIENTIST
  const Icon = S.icon
  return (
    <div
      className="rounded-xl p-4 border relative overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, rgba(168,85,247,0.08), rgba(236,72,153,0.06))',
        borderColor: 'rgba(168,85,247,0.4)',
      }}
    >
      <div className="absolute top-0 right-0 px-2 py-0.5 rounded-bl-lg text-[9px] font-mono tracking-wider"
        style={{ background: 'rgba(168,85,247,0.15)', color: '#a855f7', borderLeft: '1px solid rgba(168,85,247,0.4)', borderBottom: '1px solid rgba(168,85,247,0.4)' }}
      >
        PERMANENT · EXPERIMENTS
      </div>

      <div className="flex items-start gap-3 mb-3">
        <div
          className="w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.6)', boxShadow: '0 0 16px rgba(168,85,247,0.3)' }}
        >
          <Icon className="w-6 h-6 text-purple-300" />
        </div>
        <div className="flex-1 min-w-0 pt-1">
          <h3 className="text-base font-bold neon-text-purple">{S.name}</h3>
          <p className="text-[10px] text-[#9bb5d4] mt-0.5">{S.role}</p>
          <div className="mt-1.5 flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-pink-300" />
            <span className="text-[10px] text-pink-200 font-semibold italic">★ {S.highlight}</span>
          </div>
        </div>
      </div>

      <p className="text-[11px] text-[#cfd9f0] mb-3 leading-relaxed">{S.mission}</p>

      <div className="mb-3 p-2 rounded-md bg-purple-400/[0.06] border border-purple-400/20">
        <div className="text-[9px] uppercase tracking-wider text-purple-300 mb-0.5 font-semibold">Cadence</div>
        <div className="text-[10px] text-[#cfd9f0] leading-snug">{S.cadence}</div>
      </div>

      <div className="mb-3">
        <div className="text-[10px] uppercase tracking-wider text-[#5b6a92] mb-1.5 font-semibold">
          Weekly Experiments
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {S.experiments.map((exp) => (
            <div
              key={exp}
              className="text-[10px] px-2 py-1.5 rounded-md bg-white/[0.03] border border-purple-400/20 text-[#cfd9f0] flex items-start gap-1.5"
            >
              <Icon className="w-2.5 h-2.5 text-purple-300 flex-shrink-0 mt-0.5" />
              <span>{exp}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mb-2">
        <div className="text-[9px] uppercase tracking-wider text-[#5b6a92] mb-1 font-semibold flex items-center gap-1">
          <Cpu className="w-2.5 h-2.5" /> Real Tools ({S.tools.length})
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
          {S.tools.map((t) => (
            <div
              key={t.name}
              className="text-[9px] font-mono px-2 py-1 rounded bg-black/30 border flex items-center justify-between gap-2"
              style={{ borderColor: 'rgba(168,85,247,0.2)' }}
            >
              <span className="text-purple-300">{t.name}</span>
              <span className="text-[8px] text-[#5b6a92] truncate">{t.source}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="p-2 rounded-md border-l-2 text-[10px]"
        style={{ background: 'rgba(168,85,247,0.08)', borderLeftColor: '#a855f7' }}
      >
        <span className="text-[#5b6a92] uppercase text-[9px] tracking-wider mr-1">Output:</span>
        <span className="text-[#cfd9f0]">{S.output}</span>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────
// Sub-component: Specialist card (with activation logic)
// ──────────────────────────────────────────────────────────────────

function SpecialistCard({ spec }: { spec: typeof VID_SPECIALISTS[number] }) {
  const Icon = spec.icon
  return (
    <div
      className="glass rounded-xl p-3.5 border"
      style={{ borderColor: `${spec.color}40` }}
    >
      <div className="flex items-start gap-3 mb-2.5">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: `${spec.color}15`, border: `1px solid ${spec.color}50` }}
        >
          <Icon className="w-5 h-5" style={{ color: spec.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <h3 className="text-sm font-bold" style={{ color: spec.color }}>
              {spec.name}
            </h3>
            <span
              className="text-[8px] px-1 py-0.5 rounded-full font-mono flex items-center gap-0.5"
              style={{
                background: spec.status === 'active' ? 'rgba(16,185,129,0.15)' : 'rgba(124,137,181,0.1)',
                color: spec.status === 'active' ? '#10b981' : '#7c89b5',
                border: `1px solid ${spec.status === 'active' ? 'rgba(16,185,129,0.4)' : 'rgba(124,137,181,0.3)'}`,
              }}
            >
              {spec.status === 'active' ? '● ACTIVE' : '○ STANDBY'}
            </span>
          </div>
          <p className="text-[10px] text-[#9bb5d4] mt-0.5 leading-snug">{spec.mission}</p>
        </div>
      </div>

      <div className="mb-2">
        <div className="text-[9px] uppercase tracking-wider text-[#5b6a92] mb-1 font-semibold">
          Scope
        </div>
        <div className="flex flex-wrap gap-1">
          {spec.scope.map((s) => (
            <span
              key={s}
              className="text-[9px] px-1.5 py-0.5 rounded bg-white/[0.04] border text-[#cfd9f0]"
              style={{ borderColor: `${spec.color}25` }}
            >
              {s}
            </span>
          ))}
        </div>
      </div>

      <div
        className="mb-2 p-2 rounded-md border-l-2 text-[10px]"
        style={{ background: `${spec.color}08`, borderLeftColor: spec.color }}
      >
        <span className="text-[#5b6a92] uppercase text-[9px] tracking-wider mr-1">Activation:</span>
        <span className="text-[#cfd9f0]">{spec.activation}</span>
      </div>

      <div className="mb-2">
        <div className="text-[9px] uppercase tracking-wider text-[#5b6a92] mb-1 font-semibold flex items-center gap-1">
          <Cpu className="w-2.5 h-2.5" /> Real Tools ({spec.tools.length})
        </div>
        <div className="grid grid-cols-1 gap-1">
          {spec.tools.map((t) => (
            <div
              key={t.name}
              className="text-[9px] font-mono px-2 py-1 rounded bg-black/30 border flex items-center justify-between gap-2"
              style={{ borderColor: `${spec.color}20` }}
            >
              <span style={{ color: spec.color }}>{t.name}</span>
              <span className="text-[8px] text-[#5b6a92] truncate">{t.source}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="text-[10px] text-[#cfd9f0]">
        <span className="text-[#5b6a92] uppercase text-[9px] tracking-wider mr-1">Output:</span>
        {spec.output}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────
// Sub-component: Venture Score table
// ──────────────────────────────────────────────────────────────────

function VentureScoreTable() {
  return (
    <div
      className="rounded-xl p-4 border"
      style={{ background: 'linear-gradient(135deg, rgba(0,240,255,0.04), rgba(251,191,36,0.04))', borderColor: 'rgba(251,191,36,0.4)' }}
    >
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="w-4 h-4 text-amber-300" />
        <h3 className="text-sm font-bold text-amber-200">Venture Score — Threshold</h3>
        <span
          className="ml-auto text-xs px-2 py-0.5 rounded-full font-mono font-bold"
          style={{ background: 'rgba(251,191,36,0.15)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.5)' }}
        >
          ≥ {VENTURE_SCORE_THRESHOLD} / 100
        </span>
      </div>

      <p className="text-[10px] text-[#9bb5d4] mb-3 leading-snug">
        Every opportunity is scored on 7 weighted dimensions. <strong className="text-amber-200">Anything below {VENTURE_SCORE_THRESHOLD} → never built.</strong> No exceptions, no override, no "gut feeling" appeals to the Director.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="text-[9px] uppercase tracking-wider text-[#5b6a92] border-b border-amber-400/20">
              <th className="py-1.5 pr-3 font-semibold">Category</th>
              <th className="py-1.5 pr-3 font-semibold">Weight</th>
              <th className="py-1.5 font-semibold">What it measures</th>
            </tr>
          </thead>
          <tbody>
            {VENTURE_SCORE_CATEGORIES.map((c) => (
              <tr key={c.category} className="border-b border-white/5">
                <td className="py-2 pr-3 text-[11px] font-semibold text-[#e0e7ff]">{c.category}</td>
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-2">
                    <div className="w-16 h-1.5 rounded-full bg-white/5 overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${c.weight * 5}%`,
                          background: 'linear-gradient(90deg, #00f0ff, #fbbf24)',
                        }}
                      />
                    </div>
                    <span className="text-[10px] font-mono text-amber-200">{c.weight}%</span>
                  </div>
                </td>
                <td className="py-2 text-[10px] text-[#9bb5d4]">{c.description}</td>
              </tr>
            ))}
            <tr className="bg-amber-400/[0.05]">
              <td className="py-2 pr-3 text-[11px] font-bold text-amber-200">TOTAL</td>
              <td className="py-2 pr-3 text-[10px] font-mono text-amber-200">100%</td>
              <td className="py-2 text-[10px] text-amber-200 font-semibold">
                Weighted sum must ≥ {VENTURE_SCORE_THRESHOLD} to advance to validation.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────
// Sub-component: 13-step Workflow with real example data
// ──────────────────────────────────────────────────────────────────

function WorkflowTimeline() {
  return (
    <div className="rounded-xl p-4 border border-cyan-400/25 bg-cyan-400/[0.02]">
      <div className="flex items-center gap-2 mb-1">
        <Activity className="w-4 h-4 text-cyan-300" />
        <h3 className="text-sm font-bold neon-text-cyan">13-Step Workflow</h3>
      </div>
      <p className="text-[10px] text-[#9bb5d4] mb-4 leading-snug">
        Every opportunity follows this exact sequence. No skipping. The example data shown is from the most recent run — venture: <strong className="text-cyan-200">AI Resume Tuner for Shopify Merchants</strong>.
      </p>

      <div className="relative">
        {/* Vertical connector line */}
        <div
          className="absolute left-[18px] top-2 bottom-2 w-px"
          style={{ background: 'linear-gradient(180deg, #00f0ff33, #a855f733, #ec489933)' }}
        />
        <div className="space-y-3">
          {VID_WORKFLOW_STAGES.map((stage, idx) => {
            const Icon = stage.icon
            return (
              <motion.div
                key={stage.step}
                initial={{ opacity: 0, x: -10 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: idx * 0.04 }}
                className="relative flex items-start gap-3 pl-0"
              >
                {/* Step circle */}
                <div
                  className="relative z-10 w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{
                    background: 'rgba(0,240,255,0.1)',
                    border: '1px solid rgba(0,240,255,0.5)',
                    boxShadow: '0 0 12px rgba(0,240,255,0.25)',
                  }}
                >
                  <Icon className="w-4 h-4 text-cyan-300" />
                </div>

                {/* Step content */}
                <div className="flex-1 min-w-0 pb-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-cyan-400/10 border border-cyan-400/30 text-cyan-200">
                      STEP {stage.step}
                    </span>
                    <h4 className="text-sm font-bold text-[#e0e7ff]">{stage.name}</h4>
                    <span className="text-[9px] text-[#5b6a92]">
                      · Owner: <span className="text-[#9bb5d4]">{stage.owner}</span>
                    </span>
                  </div>
                  <p className="text-[10px] text-[#a5b4fc] mb-1.5 leading-snug">{stage.description}</p>

                  {/* REAL example data */}
                  <div className="rounded-md p-2 bg-black/30 border border-cyan-400/15">
                    <div className="flex items-center gap-1 mb-1">
                      <span className="text-[8px] uppercase tracking-wider text-[#5b6a92] font-semibold">
                        Real example →
                      </span>
                      {stage.example.metric && (
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-amber-400/10 border border-amber-400/30 text-amber-200">
                          {stage.example.metric}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-[#cfd9f0] leading-snug">
                      <span className="text-cyan-300 font-semibold">Venture:</span> {stage.example.venture}
                    </div>
                    <div className="text-[10px] text-[#9bb5d4] leading-snug mt-0.5">
                      <span className="text-purple-300 font-semibold">Artifact:</span> {stage.example.artifact}
                    </div>
                  </div>
                </div>

                {/* Arrow connector */}
                {idx < VID_WORKFLOW_STAGES.length - 1 && (
                  <div className="absolute left-[14px] -bottom-2 z-0">
                    <ArrowRight className="w-3 h-3 text-cyan-400/30 rotate-90" />
                  </div>
                )}
              </motion.div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────
// Sub-component: Organizational Rules (NEVER list)
// ──────────────────────────────────────────────────────────────────

function OrgRulesCard() {
  return (
    <div
      className="rounded-xl p-4 border border-red-500/30 bg-red-500/[0.03]"
    >
      <div className="flex items-center gap-2 mb-2">
        <Skull className="w-4 h-4 text-red-400" />
        <h3 className="text-sm font-bold text-red-300">Organizational Rules — The Studio NEVER</h3>
      </div>
      <p className="text-[10px] text-[#9bb5d4] mb-3 leading-snug">
        These are non-negotiable guardrails. A violation of any single rule is grounds for the Director to terminate the venture immediately, regardless of Venture Score.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {VID_ORG_RULES_NEVER.map((rule) => (
          <div
            key={rule}
            className="flex items-start gap-2 p-2 rounded-md bg-red-500/[0.05] border border-red-500/20"
          >
            <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
            <span className="text-[11px] text-[#cfd9f0]">{rule}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────
// Sub-component: Division KPIs
// ──────────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────
// Live KPI hook — fetches REAL data from /api/system/vid-kpis on mount
// and refreshes every 30 seconds. Falls back to seeded numbers if the
// fetch fails so the UI never breaks.
// ──────────────────────────────────────────────────────────────────

interface LiveKpis {
  businessesCreated: number
  businessesValidated: number
  businessesLaunched: number
  revenue: number
  portfolioROI: number
  successRate: number
  timeToRevenueDays: number
  orgLearning: number
  enterpriseValue: number
  knowledgeTransferRate: number
}

interface LiveVenture {
  id: string
  name: string
  type: string
  lifecycle: string
  mrr: number
  customers: number
  automationLevel: number
  knowledgeAssets: number
  score: number
}

function useLiveKpis() {
  const [kpis, setKpis] = useState<LiveKpis | null>(null)
  const [ventures, setVentures] = useState<LiveVenture[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch('/api/system/vid-kpis', { cache: 'no-store' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (cancelled) return
        if (data.ok) {
          setKpis(data.kpis)
          setVentures(data.ventures || [])
          setGeneratedAt(data.generatedAt || null)
          setError(null)
        } else {
          setError(data.error || 'Failed to load KPIs')
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Network error')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    // Refresh every 30s so the dashboard stays live as the portfolio changes
    const timer = setInterval(load, 30_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  return { kpis, ventures, loading, error, generatedAt }
}

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
  return `$${n.toFixed(0)}`
}

function formatPct(n: number): string {
  return `${Math.round(n * 100)}%`
}

// ──────────────────────────────────────────────────────────────────
// Sub-component: Division KPIs (live data)
// ──────────────────────────────────────────────────────────────────

function KpiCard() {
  const { kpis, loading, error, generatedAt } = useLiveKpis()

  // Map each KPI definition to its live value (or fallback to seeded current)
  const liveValue = (kpiName: string): { current: string; live: boolean } => {
    if (!kpis) return { current: '—', live: false }
    switch (kpiName) {
      case 'Businesses Created':         return { current: String(kpis.businessesCreated), live: true }
      case 'Businesses Validated':       return { current: String(kpis.businessesValidated), live: true }
      case 'Businesses Launched':        return { current: String(kpis.businessesLaunched), live: true }
      case 'Revenue':                    return { current: formatCurrency(kpis.revenue), live: true }
      case 'Portfolio ROI':              return { current: `${kpis.portfolioROI.toFixed(2)}×`, live: true }
      case 'Success Rate':               return { current: formatPct(kpis.successRate), live: true }
      case 'Time to Revenue':            return { current: `${kpis.timeToRevenueDays}d`, live: true }
      case 'Organizational Learning':    return { current: String(kpis.orgLearning), live: true }
      case 'Enterprise Value Created':   return { current: formatCurrency(kpis.enterpriseValue), live: true }
      case 'Knowledge Transfer Rate':   return { current: kpis.knowledgeTransferRate.toFixed(2), live: true }
      default:                          return { current: '—', live: false }
    }
  }

  return (
    <div>
      {/* Status row */}
      <div className="flex items-center gap-2 mb-3 text-[10px]">
        {loading ? (
          <span className="text-cyan-300 flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" /> Loading live KPIs…
          </span>
        ) : error ? (
          <span className="text-amber-300">⚠ Live data unavailable ({error}) — showing fallback values</span>
        ) : (
          <span className="text-emerald-300 flex items-center gap-1">
            ● LIVE
            {generatedAt && (
              <span className="text-[#5b6a92] ml-1">
                · updated {new Date(generatedAt).toLocaleTimeString()}
              </span>
            )}
            <span className="text-[#5b6a92] ml-1">· auto-refresh 30s</span>
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
        {VID_KPIS.map((kpi) => {
          const { current, live } = liveValue(kpi.name)
          return (
            <div
              key={kpi.name}
              className="glass rounded-lg p-2.5 border border-cyan-400/15"
            >
              <div className="text-[10px] font-semibold text-cyan-200 leading-tight">{kpi.name}</div>
              <div className="flex items-baseline gap-1 mt-1">
                <span className="text-base font-bold text-[#e0e7ff]">{current}</span>
                <span className="text-[9px] text-[#5b6a92]">/ {kpi.target}</span>
                {live && (
                  <span className="ml-auto text-[8px] text-emerald-400 flex items-center gap-0.5" title="Live data from /api/system/vid-kpis">
                    <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
                  </span>
                )}
              </div>
              <div className="text-[9px] text-[#7c89b5] mt-1 leading-snug">{kpi.description}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────
// Sub-component: Knowledge Transfer Rate banner (live data)
// ──────────────────────────────────────────────────────────────────

function KnowledgeTransferBanner() {
  const ktr = KNOWLEDGE_TRANSFER_RATE_BANNER
  const { kpis, loading } = useLiveKpis()
  const liveCurrent = kpis?.knowledgeTransferRate
  const currentNum = liveCurrent ?? parseFloat(ktr.current)
  const targetNum = parseFloat(ktr.target.replace('≥ ', ''))
  const pct = Math.min(100, Math.round((currentNum / targetNum) * 100))
  return (
    <div
      className="rounded-xl p-4 border relative overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, rgba(168,85,247,0.1), rgba(0,240,255,0.05))',
        borderColor: 'rgba(168,85,247,0.5)',
      }}
    >
      <div className="flex items-start gap-3 mb-3">
        <Crown className="w-6 h-6 text-purple-300 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold flex items-center gap-1.5">
            The Single Most Important Number in the Division
            {!loading && kpis && (
              <span className="text-[8px] text-emerald-400 flex items-center gap-0.5">
                <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" /> LIVE
              </span>
            )}
          </div>
          <h3 className="text-lg font-bold neon-text-purple">{ktr.label}</h3>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-[#e0e7ff]">{currentNum.toFixed(2)}</div>
          <div className="text-[9px] text-[#5b6a92]">target {ktr.target}</div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-3">
        <div className="w-full h-2 rounded-full bg-white/5 overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{
              width: `${pct}%`,
              background: 'linear-gradient(90deg, #a855f7, #00f0ff)',
              boxShadow: '0 0 12px rgba(168,85,247,0.5)',
            }}
          />
        </div>
        <div className="text-[9px] text-[#7c89b5] mt-1">{pct}% to target</div>
      </div>

      <p className="text-[10px] text-[#cfd9f0] leading-relaxed">{ktr.description}</p>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────
// Sub-component: Mission banner
// ──────────────────────────────────────────────────────────────────

function MissionBanner() {
  return (
    <div
      className="rounded-xl p-4 border relative overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, rgba(0,240,255,0.07), rgba(16,185,129,0.05))',
        borderColor: 'rgba(0,240,255,0.35)',
      }}
    >
      <div className="absolute top-0 right-0 px-2 py-0.5 rounded-bl-lg text-[9px] font-mono tracking-wider"
        style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981', borderLeft: '1px solid rgba(16,185,129,0.4)', borderBottom: '1px solid rgba(16,185,129,0.4)' }}
      >
        DIVISION MISSION
      </div>
      <div className="flex items-start gap-3">
        <Target className="w-5 h-5 text-emerald-300 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-[#e0e7ff] font-semibold italic leading-relaxed">
          &ldquo;{VID_MISSION}&rdquo;
        </p>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────
// Sub-component: Director Chat Modal (direct channel to VID Director)
// ──────────────────────────────────────────────────────────────────

function DirectorChatModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [history, setHistory] = useState<{ role: 'user' | 'director'; text: string }[]>([])

  const send = async () => {
    if (!message.trim() || sending) return
    const userMsg = message.trim()
    setHistory((h) => [...h, { role: 'user', text: userMsg }])
    setMessage('')
    setSending(true)
    try {
      const res = await fetch('/api/team/vid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg }),
      })
      const data = await res.json()
      const reply = data.ok
        ? (data.response || 'No response from the Director.')
        : `⚠ Error: ${data.error || 'Unknown error'}`
      setHistory((h) => [...h, { role: 'director', text: reply }])
    } catch (e: any) {
      const errMsg = `Network error: ${e?.message ?? 'failed to reach Director'}`
      setHistory((h) => [...h, { role: 'director', text: errMsg }])
    } finally {
      setSending(false)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="glass-strong rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden"
            style={{ borderColor: 'rgba(0,240,255,0.4)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div
              className="p-4 flex items-center gap-3 border-b"
              style={{ background: 'linear-gradient(135deg, rgba(0,240,255,0.08), rgba(168,85,247,0.06))', borderColor: 'rgba(0,240,255,0.25)' }}
            >
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{
                  background: 'linear-gradient(135deg, rgba(0,240,255,0.25), rgba(168,85,247,0.25))',
                  border: '1px solid rgba(0,240,255,0.6)',
                  boxShadow: '0 0 18px rgba(0,240,255,0.35)',
                }}
              >
                <Crown className="w-5 h-5 text-cyan-300" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <h3 className="text-sm font-bold neon-text-cyan">VID Director</h3>
                  <span className="text-[8px] px-1.5 py-0.5 rounded-full font-mono"
                    style={{ background: 'rgba(0,240,255,0.12)', color: '#00f0ff', border: '1px solid rgba(0,240,255,0.35)' }}
                  >
                    RANK #2 · CEO-REPORT
                  </span>
                </div>
                <p className="text-[10px] text-[#9bb5d4] mt-0.5">
                  Direct channel · Venture Intelligence Division · 2nd smartest agent in the organization
                </p>
              </div>
              <button onClick={onClose} className="text-[#7c89b5] hover:text-white p-1" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Conversation history */}
            <div className="flex-1 overflow-y-auto scroll-cyan p-3 space-y-3 min-h-[200px]">
              {history.length === 0 && (
                <div className="text-center py-8 px-4">
                  <Crown className="w-8 h-8 text-cyan-300/50 mx-auto mb-2" />
                  <p className="text-xs text-[#9bb5d4]">
                    You are now speaking directly with the <strong className="text-cyan-200">VID Director</strong> —
                    the 2nd smartest agent in the organization.
                  </p>
                  <p className="text-[10px] text-[#5b6a92] mt-2 leading-relaxed">
                    Ask about portfolio health, the latest venture decisions, current experiments,
                    or instruct the Director to kill / double-down on a venture. The Director will
                    respond with deep, evidence-based reasoning.
                  </p>
                </div>
              )}
              {history.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-lg p-2.5 text-[11px] whitespace-pre-wrap leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-cyan-400/15 border border-cyan-400/40 text-[#e0e7ff]'
                        : 'bg-white/[0.04] border border-purple-400/30 text-[#cfd9f0]'
                    }`}
                  >
                    {msg.role === 'director' && (
                      <div className="text-[9px] text-purple-300 font-semibold mb-1 flex items-center gap-1">
                        <Crown className="w-2.5 h-2.5" /> VID Director
                      </div>
                    )}
                    {msg.text}
                  </div>
                </div>
              ))}
              {sending && (
                <div className="flex justify-start">
                  <div className="max-w-[85%] rounded-lg p-2.5 text-[11px] bg-white/[0.04] border border-purple-400/30 text-[#9bb5d4] flex items-center gap-2">
                    <Loader2 className="w-3 h-3 animate-spin text-cyan-300" />
                    <span>The Director is reasoning…</span>
                  </div>
                </div>
              )}
            </div>

            {/* Composer */}
            <div className="p-3 border-t border-cyan-400/20">
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={2}
                placeholder="Address the VID Director directly… (e.g. 'Should we kill the AI Resume Tuner?' or 'What's our weakest venture right now?')"
                className="w-full glass rounded-lg p-2.5 text-xs text-[#e0e7ff] placeholder:text-[#5b6a92] outline-none focus:border-cyan-400/70 border border-white/10 mb-2 resize-none"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    send()
                  }
                }}
              />
              <button
                onClick={send}
                disabled={sending || !message.trim()}
                className="w-full py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: 'linear-gradient(135deg, rgba(0,240,255,0.18), rgba(168,85,247,0.18))',
                  border: '1px solid rgba(0,240,255,0.5)',
                  color: '#00f0ff',
                }}
              >
                {sending ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Director reasoning…</>
                ) : (
                  <><Send className="w-3.5 h-3.5" /> Send to VID Director</>
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ──────────────────────────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────────────────────────

export function VidTab() {
  const [directorOpen, setDirectorOpen] = useState(false)
  return (
    <div className="flex-1 overflow-y-auto scroll-cyan p-4 sm:p-6">
      <div className="max-w-6xl mx-auto">
        {/* ───── Header ───── */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-5"
        >
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <Crown className="w-5 h-5 text-cyan-300" />
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              <span className="neon-text-cyan">Venture Intelligence</span>{' '}
              <span className="neon-text-purple">Division</span>
            </h1>
            <span
              className="text-[9px] px-2 py-0.5 rounded-full font-mono tracking-wider"
              style={{ background: 'rgba(0,240,255,0.1)', color: '#00f0ff', border: '1px solid rgba(0,240,255,0.4)' }}
            >
              REPORTS DIRECTLY TO CEO
            </span>
          </div>
          <p className="text-xs text-[#9bb5d4] leading-relaxed">
            The 2nd most powerful department in the organization — only the CEO outranks it. Builds, scores,
            launches, and manages ventures. Its true output is not businesses but{' '}
            <span className="text-purple-200 font-semibold">repeatable venture-construction knowledge</span> —
            a permanent strategic asset of the organization.
          </p>
        </motion.div>

        {/* ───── Mission + Direct Channel to Director ───── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-5">
          {/* Mission banner — 2/3 width */}
          <div className="lg:col-span-2">
            <MissionBanner />
          </div>
          {/* Direct Channel button — 1/3 width */}
          <button
            onClick={() => setDirectorOpen(true)}
            className="rounded-xl p-4 border text-left transition hover:brightness-110 flex flex-col justify-between"
            style={{
              background: 'linear-gradient(135deg, rgba(0,240,255,0.1), rgba(168,85,247,0.1))',
              borderColor: 'rgba(0,240,255,0.5)',
              boxShadow: '0 0 16px rgba(0,240,255,0.15)',
            }}
          >
            <div className="flex items-center gap-2 mb-2">
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center"
                style={{ background: 'rgba(0,240,255,0.18)', border: '1px solid rgba(0,240,255,0.6)' }}
              >
                <Crown className="w-4.5 h-4.5 text-cyan-300" />
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-wider text-[#9bb5d4] font-semibold">Direct Channel</div>
                <div className="text-sm font-bold neon-text-cyan">VID Director</div>
              </div>
            </div>
            <p className="text-[10px] text-[#a5b4fc] leading-snug mb-2">
              Open a direct line to the 2nd smartest agent. Ask about portfolio health, kill/double-down decisions, current experiments.
            </p>
            <div
              className="text-[10px] font-semibold px-2 py-1 rounded-md inline-flex items-center gap-1.5 self-start"
              style={{ background: 'rgba(0,240,255,0.15)', color: '#00f0ff', border: '1px solid rgba(0,240,255,0.4)' }}
            >
              <Send className="w-3 h-3" /> Open channel
            </div>
          </button>
        </div>

        {/* ───── Top stats banner ───── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {[
            { label: 'Leader', value: '1', color: '#00f0ff', sub: 'VID Director · Rank #2' },
            { label: 'Permanent Members', value: '9', color: '#a855f7', sub: '8 + Chief Venture Scientist' },
            { label: 'Specialists', value: '4', color: '#fbbf24', sub: 'On-demand activation' },
            { label: 'Venture Score Threshold', value: '≥87', color: '#10b981', sub: '/ 100 · no exceptions' },
          ].map((s) => (
            <div key={s.label} className="glass rounded-lg p-3 border border-white/10">
              <div className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</div>
              <div className="text-[10px] text-[#7c89b5] uppercase tracking-wider mt-0.5">{s.label}</div>
              <div className="text-[9px] text-[#5b6a92] mt-0.5">{s.sub}</div>
            </div>
          ))}
        </div>

        {/* ───── Knowledge Transfer Rate banner (top placement — most important KPI) ───── */}
        <div className="mb-5">
          <KnowledgeTransferBanner />
        </div>

        {/* ───── Org hierarchy accordions ───── */}
        <div className="space-y-3 mb-6">
          {/* 1 Leader */}
          <OrgSectionAccordion
            section={VID_ORG_SECTIONS[0]}
            defaultOpen={true}
          >
            <LeaderCard />
          </OrgSectionAccordion>

          {/* 8 Permanent Members + Chief Venture Scientist */}
          <OrgSectionAccordion
            section={VID_ORG_SECTIONS[1]}
            defaultOpen={false}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
              {VID_MEMBERS.map((m) => (
                <MemberCard key={m.id} member={m} />
              ))}
            </div>
            <div>
              <ScientistCard />
            </div>
          </OrgSectionAccordion>

          {/* 4 Specialists */}
          <OrgSectionAccordion
            section={VID_ORG_SECTIONS[2]}
            defaultOpen={false}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {VID_SPECIALISTS.map((s) => (
                <SpecialistCard key={s.id} spec={s} />
              ))}
            </div>
          </OrgSectionAccordion>
        </div>

        {/* ───── Venture Score ───── */}
        <div className="mb-6">
          <VentureScoreTable />
        </div>

        {/* ───── 13-step Workflow ───── */}
        <div className="mb-6">
          <WorkflowTimeline />
        </div>

        {/* ───── Organizational Rules ───── */}
        <div className="mb-6">
          <OrgRulesCard />
        </div>

        {/* ───── Division KPIs ───── */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4 text-cyan-300" />
            <h3 className="text-sm font-bold neon-text-cyan">Division KPIs</h3>
            <span className="text-[10px] text-[#5b6a92]">— current vs target</span>
          </div>
          <KpiCard />
        </div>

        {/* Footer note */}
        <div className="text-center text-[9px] text-[#5b6a92] py-3">
          VID · the most powerful department after the CEO · reports directly to the CEO · Knowledge Transfer Rate = compound interest on organizational capital
        </div>
      </div>

      {/* ───── Director Chat Modal (direct channel to the VID Director) ───── */}
      <DirectorChatModal open={directorOpen} onClose={() => setDirectorOpen(false)} />
    </div>
  )
}
