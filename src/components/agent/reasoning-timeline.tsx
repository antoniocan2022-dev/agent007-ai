'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search,
  Link2,
  Palette,
  Eye,
  Terminal,
  Database,
  Brain,
  FileText,
  BookOpen,
  Book,
  Library,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Loader2,
  Lightbulb,
  Sparkles,
  Box,
  TrendingUp,
  Crosshair,
  Hammer,
  PenLine,
  Activity,
  RefreshCw,
  Scale,
  Landmark,
  Wrench,
  Bot,
  Zap,
  Globe,
  Code,
  Cpu,
  Rocket,
  Target,
  DollarSign,
  Briefcase,
  LineChart,
  PieChart,
  ShieldCheck,
  Cloud,
  Compass,
  Feather,
  type LucideIcon,
} from 'lucide-react'
import type { ToolStep } from '@/store/chat-store'

const ICONS: Record<string, LucideIcon> = {
  web_search: Search,
  page_reader: Link2,
  image_gen: Palette,
  vision: Eye,
  code_exec: Terminal,
  memory_store: Database,
  memory_recall: Brain,
  file_read: FileText,
  wikipedia_search: BookOpen,
  wikipedia_read: Book,
  free_apis_directory: Library,
}

const LABELS: Record<string, string> = {
  web_search: 'Web Search',
  page_reader: 'Page Reader',
  image_gen: 'Image Generation',
  vision: 'Vision Analysis',
  code_exec: 'Code Execution',
  memory_store: 'Memory Store',
  memory_recall: 'Memory Recall',
  file_read: 'File Read',
  wikipedia_search: 'Wikipedia Search',
  wikipedia_read: 'Wikipedia Read',
  free_apis_directory: 'Free APIs Directory',
}

/** Sub-agent icon name → lucide component (for the colored sub-agent badges). */
export const SUBAGENT_ICONS: Record<string, LucideIcon> = {
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
  // Common fallback icons for custom agents
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
  Bot: Sparkles,
  Brain,
  Zap: Activity,
  Globe: Search,
  Database,
  Terminal,
  Code: Terminal,
  Cpu: Activity,
  Rocket: TrendingUp,
  Target,
  DollarSign: TrendingUp,
  Briefcase: Box,
  LineChart: TrendingUp,
  PieChart: Activity,
  ShieldCheck: Scale,
  FileText,
  Lightbulb,
  Cloud: Search,
  Compass: Search,
  Feather: PenLine,
}

/** Map a subagent icon name (string from DB) → LucideIcon component.
 * Falls back to Sparkles if unknown. */
export function getSubagentIcon(name?: string): LucideIcon {
  if (!name) return Sparkles
  return (SUBAGENT_ICONS as Record<string, LucideIcon>)[name] ?? Sparkles
}

/** Human-readable label for a manage action. */
const MANAGE_LABELS: Record<string, string> = {
  create_agent: 'Create Sub-Agent',
  edit_agent: 'Edit Sub-Agent',
  delete_agent: 'Delete Sub-Agent',
  toggle_agent: 'Toggle Sub-Agent',
  set_income_goal: 'Set Income Goal',
  set_growth_target: 'Set Growth Target',
  log_income: 'Log Income',
  create_schedule: 'Create Schedule',
  delete_schedule: 'Delete Schedule',
  update_settings: 'Update Settings',
}

function relativeTime(ts?: number): string {
  if (!ts) return ''
  const diff = Math.max(0, Date.now() - ts)
  if (diff < 1000) return 'just now'
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`
  return new Date(ts).toLocaleTimeString()
}

function truncate(s: string, n = 240): string {
  if (!s) return ''
  return s.length > n ? s.slice(0, n) + '…' : s
}

function SubagentChip({ step }: { step: ToolStep }) {
  const Icon = SUBAGENT_ICONS[step.subagentIcon ?? ''] ?? Sparkles
  const color = step.subagentColor ?? '#00f0ff'
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold tracking-wider border"
      style={{
        color,
        borderColor: `${color}55`,
        background: `${color}10`,
      }}
    >
      <Icon className="w-2.5 h-2.5" />
      {step.subagentName ?? 'SUB-AGENT'}
    </span>
  )
}

function SubagentDispatchCard({ step }: { step: ToolStep }) {
  const Icon = SUBAGENT_ICONS[step.subagentIcon ?? ''] ?? Sparkles
  const color = step.subagentColor ?? '#00f0ff'
  const isRunning = step.status === 'running'

  return (
    <div className="relative pl-9">
      {/* connector line */}
      <div className="absolute left-3 top-9 bottom-0 w-px timeline-connector" aria-hidden />
      {/* step badge — colored sub-agent avatar */}
      <div
        className="absolute left-0 top-0.5 w-7 h-7 rounded-full flex items-center justify-center border-2"
        style={{
          background: `${color}15`,
          borderColor: color,
          boxShadow: isRunning ? `0 0 14px ${color}80` : `0 0 6px ${color}40`,
        }}
      >
        <Icon className="w-3.5 h-3.5" style={{ color }} />
      </div>

      <motion.div
        initial={{ opacity: 0, x: -8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3 }}
        className="glass rounded-lg p-3 mb-3"
        style={{
          borderColor: `${color}40`,
          borderWidth: 1,
          borderStyle: 'solid',
        }}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="text-sm font-extrabold tracking-wider"
            style={{ color }}
          >
            {step.subagentName ?? 'SUB-AGENT'}
          </span>
          <span className="text-[10px] text-[#7c89b5]">— dispatched</span>
          {isRunning ? (
            <span
              className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border"
              style={{ color, borderColor: `${color}55`, background: `${color}10` }}
            >
              <Loader2 className="w-3 h-3 animate-spin" /> working
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-400/30 text-emerald-200">
              <CheckCircle2 className="w-3 h-3" /> done
            </span>
          )}
          <span className="ml-auto text-[10px] text-[#7c89b5]">
            {relativeTime(step.startedAt)}
          </span>
        </div>
        <div className="text-[10px] text-[#5b6a92] mt-0.5">{step.subagentTask ? 'TASK' : ''}</div>
        {step.subagentTask && (
          <div className="mt-1 text-xs text-[#e0e7ff]/90 leading-snug">{step.subagentTask}</div>
        )}

        {step.subagentAnswer && (
          <div className="mt-2">
            <div className="text-[10px] label-tag mb-1" style={{ color }}>
              SUB-AGENT ANSWER
            </div>
            <pre
              className="text-[11px] font-mono text-[#b9c8e0] bg-black/40 rounded p-2 whitespace-pre-wrap break-words max-h-40 overflow-y-auto scroll-cyan"
              style={{ borderColor: `${color}30`, borderWidth: 1, borderStyle: 'solid' }}
            >
              {truncate(step.subagentAnswer, 800)}
            </pre>
          </div>
        )}
      </motion.div>
    </div>
  )
}

function SubagentChildCard({ step }: { step: ToolStep }) {
  const [showFullArgs, setShowFullArgs] = useState(false)
  const [showFullResult, setShowFullResult] = useState(false)

  const color = step.subagentColor ?? '#00f0ff'
  const isThought = step.kind === 'subagent_thought'
  const Icon = isThought
    ? Lightbulb
    : step.toolName
    ? ICONS[step.toolName] ?? Terminal
    : Lightbulb
  const label = isThought
    ? 'Reasoning'
    : step.toolName
    ? LABELS[step.toolName] ?? step.toolName
    : 'Step'

  const argsStr = step.toolArgs ? formatJson(step.toolArgs) : ''
  const resultStr = step.toolResult ?? ''
  const hasImageArtifacts = step.artifacts?.some((a) => a.type === 'image') ?? false

  return (
    <div className="relative pl-7 ml-3">
      {/* connector line — colored */}
      <div
        className="absolute left-2.5 top-7 bottom-0 w-px"
        style={{ background: `linear-gradient(to bottom, ${color}50, transparent)` }}
        aria-hidden
      />
      {/* small badge */}
      <div
        className="absolute left-0 top-1 w-4 h-4 rounded-full flex items-center justify-center border"
        style={{ background: `${color}15`, borderColor: `${color}80` }}
      >
        <Icon className="w-2.5 h-2.5" style={{ color }} />
      </div>

      <motion.div
        initial={{ opacity: 0, x: -6 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.25 }}
        className="glass rounded-md p-2.5 mb-2.5 ml-2"
        style={{ borderColor: `${color}25`, borderWidth: 1, borderStyle: 'solid' }}
      >
        {/* header */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <SubagentChip step={step} />
          <span className="text-[11px] font-semibold text-[#e0e7ff]">{label}</span>
          <StatusPill step={step} accentColor={color} />
        </div>

        {/* thought */}
        {step.thought && step.thought !== '__synthesizing__' && (
          <div
            className="mt-1.5 text-[11px] text-[#a8b8d8] italic pl-2"
            style={{ borderLeft: `2px solid ${color}50` }}
          >
            {step.thought}
          </div>
        )}

        {/* args */}
        {argsStr && (
          <div className="mt-1.5">
            <div className="text-[9px] label-tag mb-0.5">ARGS</div>
            <pre
              className={`text-[10px] font-mono text-[#9bb5d4] bg-black/40 rounded p-1.5 overflow-x-auto ${
                showFullArgs ? '' : 'max-h-16 overflow-y-auto scroll-cyan'
              }`}
              style={{ borderColor: `${color}20`, borderWidth: 1, borderStyle: 'solid' }}
            >
              {showFullArgs ? argsStr : truncate(argsStr, 240)}
            </pre>
            {argsStr.length > 240 && (
              <button
                onClick={() => setShowFullArgs((v) => !v)}
                className="text-[9px] mt-0.5 inline-flex items-center gap-1"
                style={{ color }}
              >
                {showFullArgs ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronRight className="w-2.5 h-2.5" />}
                {showFullArgs ? 'collapse' : 'show full args'}
              </button>
            )}
          </div>
        )}

        {/* result */}
        {resultStr && (
          <div className="mt-1.5">
            <div className="text-[9px] label-tag mb-0.5">RESULT</div>
            <pre
              className={`text-[10px] font-mono ${
                step.toolOk === false ? 'text-pink-300' : 'text-[#b9c8e0]'
              } bg-black/40 rounded p-1.5 whitespace-pre-wrap break-words ${
                showFullResult ? '' : 'max-h-24 overflow-y-auto scroll-cyan'
              }`}
              style={{ borderColor: `${color}20`, borderWidth: 1, borderStyle: 'solid' }}
            >
              {showFullResult ? resultStr : truncate(resultStr, 280)}
            </pre>
            {resultStr.length > 280 && (
              <button
                onClick={() => setShowFullResult((v) => !v)}
                className="text-[9px] mt-0.5 inline-flex items-center gap-1"
                style={{ color }}
              >
                {showFullResult ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronRight className="w-2.5 h-2.5" />}
                {showFullResult ? 'collapse' : 'show full result'}
              </button>
            )}
          </div>
        )}

        {/* UPGRADE #124 — Unverified action badge */}
        {step.verified === false && step.verificationWarning && (
          <div className="mt-1.5 flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-500/10 border border-amber-500/30 text-[10px] text-amber-300">
            <span className="font-bold">⚠️ UNVERIFIED</span>
            <span className="opacity-80">{step.verificationWarning.slice(0, 100)}</span>
          </div>
        )}
        {step.verified === true && step.toolName && (
          <div className="mt-1.5 flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/5 border border-emerald-500/20 text-[9px] text-emerald-400/70">
            <span>✅ Verified action</span>
          </div>
        )}

        {/* image artifacts */}
        {hasImageArtifacts && (
          <div className="mt-2 flex flex-wrap gap-2">
            {step.artifacts!
              .filter((a) => a.type === 'image')
              .map((a, i) => (
                <a key={i} href={a.data} target="_blank" rel="noreferrer" className="block group">
                  <img
                    src={a.data}
                    alt={a.label ?? `generated image ${i + 1}`}
                    className="w-28 h-28 object-cover rounded-md group-hover:scale-105 transition"
                    style={{
                      borderColor: `${color}60`,
                      borderWidth: 1,
                      borderStyle: 'solid',
                    }}
                  />
                  {a.label && (
                    <div className="text-[9px] text-[#7c89b5] mt-0.5 truncate max-w-[112px]">{a.label}</div>
                  )}
                </a>
              ))}
          </div>
        )}
      </motion.div>
    </div>
  )
}

function ManageActionCard({ step }: { step: ToolStep }) {
  const action = step.manageAction ?? 'unknown'
  const label = MANAGE_LABELS[action] ?? action
  const attrs = step.manageAttrs ?? {}
  const result = step.manageResult
  const isRunning = step.status === 'running'

  return (
    <div className="relative pl-9">
      {/* connector line */}
      <div className="absolute left-3 top-9 bottom-0 w-px timeline-connector" aria-hidden />
      {/* step badge — wrench icon */}
      <div
        className="absolute left-0 top-0.5 w-7 h-7 rounded-full flex items-center justify-center border-2"
        style={{
          background: 'rgba(34,211,238,0.10)',
          borderColor: '#22d3ee',
          boxShadow: isRunning ? '0 0 14px rgba(34,211,238,0.55)' : '0 0 6px rgba(34,211,238,0.35)',
        }}
      >
        <Wrench className={`w-3.5 h-3.5 text-cyan-300 ${isRunning ? 'animate-pulse' : ''}`} />
      </div>

      <motion.div
        initial={{ opacity: 0, x: -8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3 }}
        className="glass rounded-lg p-3 mb-3"
        style={{
          borderColor: 'rgba(34,211,238,0.40)',
          borderWidth: 1,
          borderStyle: 'solid',
        }}
      >
        {/* header */}
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border text-cyan-200 font-bold tracking-wider"
            style={{ borderColor: 'rgba(34,211,238,0.55)', background: 'rgba(34,211,238,0.10)' }}
          >
            <Wrench className="w-2.5 h-2.5" />
            MANAGE
          </span>
          <span className="text-sm font-semibold text-cyan-100">{label}</span>
          <StatusPill step={step} accentColor="#22d3ee" />
          <span className="ml-auto text-[10px] text-[#7c89b5]">
            {relativeTime(step.startedAt)}
          </span>
        </div>

        {/* thought */}
        {step.thought && (
          <div className="mt-2 text-xs text-[#a8b8d8] italic border-l-2 border-cyan-500/40 pl-2.5">
            {step.thought}
          </div>
        )}

        {/* attributes */}
        {Object.keys(attrs).length > 0 && (
          <div className="mt-2">
            <div className="text-[10px] label-tag mb-1">ATTRS</div>
            <pre className="text-[11px] font-mono text-[#9bb5d4] bg-black/40 border border-cyan-400/15 rounded p-2 overflow-x-auto max-h-28 overflow-y-auto scroll-cyan">
              {formatJson(attrs)}
            </pre>
          </div>
        )}

        {/* result */}
        {result && (
          <div className="mt-2">
            <div className="text-[10px] label-tag mb-1">RESULT</div>
            <pre
              className={`text-[11px] font-mono ${
                result.ok ? 'text-emerald-200' : 'text-pink-300'
              } bg-black/40 border border-cyan-400/15 rounded p-2 whitespace-pre-wrap break-words max-h-32 overflow-y-auto scroll-cyan`}
            >
              {result.ok ? '✓ ' : '✗ '}
              {result.message}
            </pre>
          </div>
        )}
      </motion.div>
    </div>
  )
}

export function ToolStepCard({ step }: { step: ToolStep }) {
  const [showFullArgs, setShowFullArgs] = useState(false)
  const [showFullResult, setShowFullResult] = useState(false)

  // Sub-agent dispatch — render as a header card with sub-agent avatar/name
  if (step.kind === 'subagent_dispatch') {
    return <SubagentDispatchCard step={step} />
  }
  // Sub-agent child steps — render indented, colored by sub-agent
  if (step.kind === 'subagent_thought' || step.kind === 'subagent_tool') {
    return <SubagentChildCard step={step} />
  }
  // Manage action — render as a cyan wrench-labeled step card
  if (step.kind === 'manage_action') {
    return <ManageActionCard step={step} />
  }

  // Super-agent step (default)
  const isThoughtOnly = !step.toolName
  const isSynthesizing = step.thought === '__synthesizing__'
  const Icon = isSynthesizing
    ? RefreshCw
    : step.toolName
    ? ICONS[step.toolName] ?? Terminal
    : Lightbulb
  const label = isSynthesizing
    ? 'Synthesizing'
    : step.toolName
    ? LABELS[step.toolName] ?? step.toolName
    : 'Reasoning'

  const argsStr = step.toolArgs ? formatJson(step.toolArgs) : ''
  const resultStr = step.toolResult ?? ''
  const hasImageArtifacts = step.artifacts?.some((a) => a.type === 'image') ?? false

  return (
    <div className="relative pl-9">
      {/* connector line */}
      <div className="absolute left-3 top-9 bottom-0 w-px timeline-connector" aria-hidden />
      {/* step badge */}
      <div className="absolute left-0 top-0.5 w-7 h-7 rounded-full step-badge flex items-center justify-center text-[11px] font-bold">
        {step.stepNumber}
      </div>

      <motion.div
        initial={{ opacity: 0, x: -8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3 }}
        className={`glass rounded-lg p-3 mb-3 ${isThoughtOnly ? 'border-purple-400/25' : ''}`}
      >
        {/* header row */}
        <div className="flex items-center gap-2 flex-wrap">
          <div
            className={`w-6 h-6 rounded-md flex items-center justify-center ${
              isThoughtOnly
                ? 'bg-purple-500/15 border border-purple-400/30 text-purple-300'
                : 'bg-cyan-500/15 border border-cyan-400/30 text-cyan-300'
            } ${isSynthesizing ? 'animate-spin' : ''}`}
          >
            <Icon className="w-3.5 h-3.5" />
          </div>
          <span className="text-sm font-semibold text-[#e0e7ff]">{label}</span>
          <StatusPill step={step} />
          <span className="ml-auto text-[10px] text-[#7c89b5]">
            {relativeTime(step.startedAt)}
          </span>
        </div>

        {/* thought */}
        {step.thought && !isSynthesizing && (
          <div className="mt-2 text-xs text-[#a8b8d8] italic border-l-2 border-purple-500/40 pl-2.5">
            {step.thought}
          </div>
        )}
        {isSynthesizing && (
          <div className="mt-2 text-xs text-cyan-300 italic">
            Super Agent is synthesizing the final answer from sub-agent outputs…
          </div>
        )}

        {/* args */}
        {argsStr && (
          <div className="mt-2">
            <div className="text-[10px] label-tag mb-1">ARGS</div>
            <pre
              className={`text-[11px] font-mono text-[#9bb5d4] bg-black/40 border border-cyan-400/10 rounded p-2 overflow-x-auto ${
                showFullArgs ? '' : 'max-h-20 overflow-y-auto scroll-cyan'
              }`}
            >
              {showFullArgs ? argsStr : truncate(argsStr, 320)}
            </pre>
            {argsStr.length > 320 && (
              <button
                onClick={() => setShowFullArgs((v) => !v)}
                className="text-[10px] text-cyan-300 hover:text-cyan-200 mt-1 inline-flex items-center gap-1"
              >
                {showFullArgs ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                {showFullArgs ? 'collapse' : 'show full args'}
              </button>
            )}
          </div>
        )}

        {/* result preview */}
        {resultStr && (
          <div className="mt-2">
            <div className="text-[10px] label-tag mb-1">RESULT</div>
            <pre
              className={`text-[11px] font-mono ${
                step.toolOk === false ? 'text-pink-300' : 'text-[#b9c8e0]'
              } bg-black/40 border border-cyan-400/10 rounded p-2 whitespace-pre-wrap break-words ${
                showFullResult ? '' : 'max-h-28 overflow-y-auto scroll-cyan'
              }`}
            >
              {showFullResult ? resultStr : truncate(resultStr, 360)}
            </pre>
            {resultStr.length > 360 && (
              <button
                onClick={() => setShowFullResult((v) => !v)}
                className="text-[10px] text-cyan-300 hover:text-cyan-200 mt-1 inline-flex items-center gap-1"
              >
                {showFullResult ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                {showFullResult ? 'collapse' : 'show full result'}
              </button>
            )}
          </div>
        )}

        {/* UPGRADE #124 — Unverified action badge */}
        {step.verified === false && step.verificationWarning && (
          <div className="mt-1.5 flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-500/10 border border-amber-500/30 text-[10px] text-amber-300">
            <span className="font-bold">⚠️ UNVERIFIED</span>
            <span className="opacity-80">{step.verificationWarning.slice(0, 100)}</span>
          </div>
        )}
        {step.verified === true && step.toolName && (
          <div className="mt-1.5 flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/5 border border-emerald-500/20 text-[9px] text-emerald-400/70">
            <span>✅ Verified action</span>
          </div>
        )}

        {/* image artifacts */}
        {hasImageArtifacts && (
          <div className="mt-2 flex flex-wrap gap-2">
            {step.artifacts!
              .filter((a) => a.type === 'image')
              .map((a, i) => (
                <a
                  key={i}
                  href={a.data}
                  target="_blank"
                  rel="noreferrer"
                  className="block group"
                >
                  <img
                    src={a.data}
                    alt={a.label ?? `generated image ${i + 1}`}
                    className="w-32 h-32 object-cover rounded-md border border-cyan-400/30 group-hover:border-cyan-400/70 group-hover:shadow-[0_0_18px_rgba(0,240,255,0.4)] transition"
                  />
                  {a.label && (
                    <div className="text-[9px] text-[#7c89b5] mt-1 truncate max-w-[128px]">
                      {a.label}
                    </div>
                  )}
                </a>
              ))}
          </div>
        )}
      </motion.div>
    </div>
  )
}

function StatusPill({ step, accentColor }: { step: ToolStep; accentColor?: string }) {
  const color = accentColor
  if (step.status === 'running') {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border"
        style={{
          color: color ?? '#67e8f9',
          borderColor: color ? `${color}55` : 'rgba(34,211,238,0.4)',
          background: color ? `${color}10` : 'rgba(34,211,238,0.15)',
        }}
      >
        <Loader2 className="w-3 h-3 animate-spin" /> running
      </span>
    )
  }
  if (step.status === 'error') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-pink-500/15 border border-pink-400/40 text-pink-200">
        <XCircle className="w-3 h-3" /> error
      </span>
    )
  }
  if (step.status === 'thinking') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-purple-500/15 border border-purple-400/40 text-purple-200">
        <span className="typing-dot" /> thinking
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-400/30 text-emerald-200">
      <CheckCircle2 className="w-3 h-3" /> done
    </span>
  )
}

function formatJson(v: any): string {
  if (typeof v === 'string') {
    // try to pretty-print if it's already JSON
    try {
      return JSON.stringify(JSON.parse(v), null, 2)
    } catch {
      return v
    }
  }
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

// UPGRADE #125 — Rec 3B: Collapse old tool steps (show last 3, expand on click)
const MAX_VISIBLE_STEPS = 3

export function ReasoningTimeline({ steps }: { steps?: ToolStep[] }) {
  const [showAll, setShowAll] = useState(false)
  if (!steps || steps.length === 0) return null

  const visibleSteps = showAll ? steps : steps.slice(-MAX_VISIBLE_STEPS)
  const hiddenCount = steps.length - visibleSteps.length

  return (
    <div className="mb-3">
      <div className="flex items-center gap-2 mb-2">
        <div className="text-[10px] label-tag">REASONING TRACE</div>
        <div className="flex-1 h-px bg-gradient-to-r from-cyan-400/30 to-transparent" />
        {hiddenCount > 0 && (
          <button
            onClick={() => setShowAll(!showAll)}
            className="text-[9px] text-cyan-300 hover:text-cyan-200 transition flex-shrink-0"
          >
            {showAll ? '− collapse' : `+ ${hiddenCount} earlier steps`}
          </button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {visibleSteps.map((s) => (
          <ToolStepCard key={s.id} step={s} />
        ))}
      </AnimatePresence>
    </div>
  )
}
