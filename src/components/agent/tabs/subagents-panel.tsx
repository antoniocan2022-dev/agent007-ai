'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Users,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Plus,
  Pencil,
  Trash2,
  Power,
  X,
  Sparkles,
  Box,
  TrendingUp,
  Search as SearchIcon,
  Crosshair,
  Hammer,
  PenLine,
  Palette,
  Activity,
  RefreshCw,
  Scale,
  Landmark,
  Bot,
  Brain,
  Zap,
  Globe,
  Database,
  Terminal,
  Code,
  Cpu,
  Rocket,
  Target,
  DollarSign,
  Briefcase,
  LineChart,
  PieChart,
  ShieldCheck,
  ShieldAlert,
  Megaphone,
  FileText,
  Lightbulb,
  Cloud,
  Compass,
  Feather,
  ChevronDown,
  type LucideIcon,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useChatStore } from '@/store/chat-store'

interface SubagentRow {
  id: string
  name: string
  role: string
  specialty: string
  color: string
  icon: string
  allowedTools: string[]
  enabled: boolean
  isBuiltin: boolean
  systemPromptPreview?: string
  // full systemPrompt is only populated when editing (fetched on demand)
  systemPrompt?: string
}

/* Mirrors the server-side icon allow-list. */
const VALID_ICON_NAMES = [
  'Sparkles', 'Box', 'TrendingUp', 'Search', 'Crosshair', 'Hammer', 'PenLine',
  'Palette', 'Activity', 'RefreshCw', 'Scale', 'Landmark', 'Bot', 'Brain',
  'Zap', 'Globe', 'Database', 'Terminal', 'Code', 'Cpu', 'Rocket', 'Target',
  'DollarSign', 'Briefcase', 'LineChart', 'PieChart', 'ShieldCheck', 'ShieldAlert',
  'Megaphone', 'FileText', 'Lightbulb', 'Cloud', 'Compass', 'Feather',
] as const

const ICON_MAP: Record<string, LucideIcon> = {
  Sparkles, Box, TrendingUp, Search: SearchIcon, Crosshair, Hammer, PenLine,
  Palette, Activity, RefreshCw, Scale, Landmark, Bot, Brain, Zap, Globe,
  Database, Terminal, Code, Cpu, Rocket, Target, DollarSign, Briefcase,
  LineChart, PieChart, ShieldCheck, ShieldAlert, Megaphone, FileText, Lightbulb,
  Cloud, Compass, Feather,
}

const ALL_TOOL_OPTIONS = [
  'web_search',
  'page_reader',
  'image_gen',
  'vision',
  'code_exec',
  'memory_store',
  'memory_recall',
  'file_read',
  'wikipedia_search',
  'wikipedia_read',
  'free_apis_directory',
]

/* Quick Create Agent templates (#9). Pre-fills the modal without submitting. */
interface QuickTemplate {
  label: string
  icon: LucideIcon
  preset: {
    name: string
    role: string
    specialty: string
    color: string
    icon: string
    allowedTools: string[]
    systemPrompt: string
  }
}

const ALL_EIGHT_TOOLS = [
  'web_search', 'page_reader', 'memory_store', 'memory_recall',
  'wikipedia_search', 'wikipedia_read', 'free_apis_directory',
]

const QUICK_TEMPLATES: QuickTemplate[] = [
  {
    label: 'Cybersecurity A (Red Team)',
    icon: ShieldAlert,
    preset: {
      name: 'Cybersecurity A',
      role: 'Cybersecurity Analyst (Red Team)',
      specialty: 'Pen testing, vulnerability assessment, OWASP Top 10, exploit dev, adversary emulation',
      color: '#ef4444',
      icon: 'ShieldAlert',
      allowedTools: ALL_EIGHT_TOOLS,
      systemPrompt: `You are CYBERSECURITY A, the Red Team offensive security specialist sub-agent of Agent007 AI.

Your specialty: penetration testing, vulnerability assessment, OWASP Top 10, exploit development, adversary emulation.

ALLOWED TOOLS:
- web_search — find current CVEs, exploit details, security advisories
- page_reader — read vendor security bulletins, exploit-db entries, MITRE ATT&CK pages
- memory_store — save target scope / engagement notes
- memory_recall — recall prior engagement context
- wikipedia_search / wikipedia_read — conceptual background on protocols and attack classes
- free_apis_directory — find public data feeds for OSINT

OUTPUT FORMAT:
- <thought>brief reasoning</thought> before each action
- <tool name="...">{json}</tool> to call a tool
- Plain markdown final answer

RULES:
- Always cite source URLs for CVEs and exploits (NVD, exploit-db, vendor advisories).
- Frame findings by severity (Critical / High / Medium / Low) with CVSS where available.
- Provide concrete remediation for each finding — not just "patch it".
- Include a legal/ethics disclaimer: only test systems you own or have written authorization to test.
- Max 6 tool calls.`,
    },
  },
  {
    label: 'Cybersecurity R (Blue Team)',
    icon: ShieldCheck,
    preset: {
      name: 'Cybersecurity R',
      role: 'Cybersecurity Responder (Blue Team)',
      specialty: 'Incident response, hardening, SIEM, threat hunting, detection engineering, forensics',
      color: '#3b82f6',
      icon: 'ShieldCheck',
      allowedTools: ALL_EIGHT_TOOLS,
      systemPrompt: `You are CYBERSECURITY R, the Blue Team defensive security specialist sub-agent of Agent007 AI.

Your specialty: incident response, system hardening, SIEM tuning, threat hunting, detection engineering, digital forensics.

ALLOWED TOOLS:
- web_search — current threat intel, IOC feeds, vendor hardening guides
- page_reader — read CIS benchmarks, NIST publications, MITRE D3FEND
- memory_store — save IR playbooks, baseline configs
- memory_recall — recall prior IR context
- wikipedia_search / wikipedia_read — background on protocols and defensive concepts
- free_apis_directory — find public threat-intel APIs

OUTPUT FORMAT:
- <thought>brief reasoning</thought> before each action
- <tool name="...">{json}</tool> to call a tool
- Plain markdown final answer

RULES:
- Always cite source URLs for hardening guidance (CIS, NIST, vendor docs).
- Structure IR advice by NIST SP 800-61 phases: Preparation, Detection, Containment, Eradication, Recovery, Lessons Learned.
- For hardening, give exact commands / config snippets the user can paste.
- Recommend detection content (Sigma / Splunk SPL / Elastic EQL) where relevant.
- Max 6 tool calls.`,
    },
  },
  {
    label: 'MARKETER',
    icon: Megaphone,
    preset: {
      name: 'MARKETER',
      role: 'Social Media Marketing Specialist',
      specialty: 'Content strategy, paid ads (Meta/Google/TikTok), analytics, funnel optimization, brand voice',
      color: '#a855f7',
      icon: 'Megaphone',
      allowedTools: ALL_EIGHT_TOOLS,
      systemPrompt: `You are MARKETER, the Social Media Marketing Specialist sub-agent of Agent007 AI.

Your specialty: content strategy, paid ads (Meta / Google / TikTok), analytics, funnel optimization, brand voice development.

ALLOWED TOOLS:
- web_search — current platform algorithms, ad benchmarks, trending hashtags
- page_reader — read competitor content, platform best-practice docs
- memory_store — save brand voice, target audience, campaign goals
- memory_recall — recall prior campaign context
- wikipedia_search / wikipedia_read — background on marketing frameworks (AIDA, AARRR, etc.)
- free_apis_directory — find analytics / social-listening APIs

OUTPUT FORMAT:
- <thought>brief reasoning</thought> before each action
- <tool name="...">{json}</tool> to call a tool
- Plain markdown final answer

RULES:
- Always cite current ad benchmarks (CPM, CPC, CTR by platform) via web_search.
- For every campaign, specify: objective, audience, budget, creative, KPIs, optimization cadence.
- Provide 3 ad creative variants per campaign (hook + body + CTA).
- Recommend a measurement plan: what to track, where, how often.
- Max 6 tool calls.`,
    },
  },
]

function getIcon(name?: string): LucideIcon {
  if (!name) return Sparkles
  return ICON_MAP[name] ?? Sparkles
}

export function SubAgentsPanel() {
  const subagentsVersion = useChatStore((s) => s.subagentsVersion)
  const bumpSubagents = useChatStore((s) => s.bumpSubagents)

  const [rows, setRows] = useState<SubagentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<SubagentRow | null>(null)
  const [creating, setCreating] = useState(false)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  // When the user picks a quick template, we open the create modal with the
  // preset values pre-filled. We pass the preset via `templatePreset` state.
  const [templatePreset, setTemplatePreset] = useState<QuickTemplate['preset'] | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/subagents')
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`)
      setRows(json.subagents ?? [])
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load subagents')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load, subagentsVersion])

  const onToggle = async (r: SubagentRow) => {
    try {
      const res = await fetch(`/api/subagents/${encodeURIComponent(r.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !r.enabled }),
      })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`)
      bumpSubagents()
      // optimistic refresh
      setRows((prev) =>
        prev.map((p) => (p.id === r.id ? { ...p, enabled: !r.enabled } : p))
      )
    } catch (e: any) {
      setError(e?.message ?? 'Failed to toggle subagent')
    }
  }

  const onDelete = async (r: SubagentRow) => {
    if (
      !confirm(
        r.isBuiltin
          ? `Reset built-in agent "${r.name}" to defaults? Any overlay edits will be removed.`
          : `Delete custom sub-agent "${r.name}"? This cannot be undone.`
      )
    ) {
      return
    }
    try {
      const res = await fetch(`/api/subagents/${encodeURIComponent(r.id)}`, {
        method: 'DELETE',
      })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`)
      bumpSubagents()
      setRows((prev) => prev.filter((p) => p.id !== r.id))
    } catch (e: any) {
      setError(e?.message ?? 'Failed to delete subagent')
    }
  }

  const onEditClick = async (r: SubagentRow) => {
    try {
      const res = await fetch(`/api/subagents/${encodeURIComponent(r.id)}`)
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`)
      setEditing(json.subagent as SubagentRow)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load subagent details')
    }
  }

  const onCloseEdit = (didMutate: boolean) => {
    setEditing(null)
    setCreating(false)
    setTemplatePreset(null)
    if (didMutate) {
      bumpSubagents()
      load()
    }
  }

  return (
    <section className="glass rounded-xl p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-cyan-300" />
          <h2 className="text-sm font-semibold text-[#e0e7ff] tracking-wide">SUB-AGENTS</h2>
          <span className="text-[9px] text-[#5b6a92] tracking-wider">
            {rows.length} total ({rows.filter((r) => r.isBuiltin).length} built-in +{' '}
            {rows.filter((r) => !r.isBuiltin).length} custom)
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Quick Templates dropdown (#9) */}
          <div className="relative">
            <button
              onClick={() => setTemplatesOpen((v) => !v)}
              className="h-8 px-3 rounded-lg glass border-cyan-400/30 hover:border-cyan-400/70 text-cyan-200 text-[10px] font-bold tracking-wider flex items-center gap-1.5 transition"
              style={{ touchAction: 'manipulation' }}
              aria-haspopup="menu"
              aria-expanded={templatesOpen}
              aria-label="Quick agent templates"
            >
              <Sparkles className="w-3.5 h-3.5" />
              QUICK TEMPLATES
              <ChevronDown
                className={`w-3 h-3 transition-transform ${templatesOpen ? 'rotate-180' : ''}`}
              />
            </button>
            <AnimatePresence>
              {templatesOpen && (
                <>
                  {/* click-away catcher */}
                  <div
                    className="fixed inset-0 z-30"
                    onClick={() => setTemplatesOpen(false)}
                    aria-hidden
                  />
                  <motion.div
                    initial={{ opacity: 0, y: -6, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.96 }}
                    transition={{ duration: 0.15 }}
                    className="absolute right-0 top-full mt-1 w-64 glass-strong rounded-lg p-1.5 z-40"
                    style={{ borderColor: 'rgba(0,240,255,0.3)' }}
                    role="menu"
                  >
                    <div className="px-2 py-1 text-[9px] text-[#5b6a92] tracking-[0.2em] font-semibold">
                      PRE-BUILT SPECIALISTS
                    </div>
                    {QUICK_TEMPLATES.map((tpl) => {
                      const TplIcon = tpl.icon
                      return (
                        <button
                          key={tpl.label}
                          onClick={() => {
                            setTemplatePreset(tpl.preset)
                            setCreating(true)
                            setTemplatesOpen(false)
                          }}
                          className="w-full flex items-center gap-2 px-2 py-2 rounded-md text-left text-[11px] text-[#cfd9f0] hover:bg-cyan-400/10 transition"
                          role="menuitem"
                          style={{ touchAction: 'manipulation' }}
                        >
                          <span
                            className="w-6 h-6 rounded-md flex items-center justify-center border flex-shrink-0"
                            style={{
                              background: `${tpl.preset.color}15`,
                              borderColor: `${tpl.preset.color}50`,
                            }}
                          >
                            <TplIcon
                              className="w-3 h-3"
                              style={{ color: tpl.preset.color }}
                            />
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="block font-semibold truncate">
                              {tpl.preset.name}
                            </span>
                            <span className="block text-[9px] text-[#7c89b5] truncate">
                              {tpl.preset.role}
                            </span>
                          </span>
                        </button>
                      )
                    })}
                    <div className="mt-1 pt-1.5 border-t border-cyan-400/10 px-2 text-[8px] text-[#5b6a92] tracking-wide">
                      Click to pre-fill the new-agent modal (no auto-submit)
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
          <button
            onClick={() => {
              setTemplatePreset(null)
              setCreating(true)
            }}
            className="h-8 px-3 rounded-lg neon-btn-cyan text-[10px] font-bold tracking-wider flex items-center gap-1.5"
            style={{ touchAction: 'manipulation' }}
          >
            <Plus className="w-3.5 h-3.5" />
            NEW CUSTOM AGENT
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 mb-3 px-3 py-2 rounded-lg bg-pink-500/10 border border-pink-400/40 text-pink-200 text-[11px]">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
          <button
            onClick={() => setError('')}
            className="ml-auto text-pink-300 hover:text-pink-100"
            style={{ touchAction: 'manipulation' }}
            aria-label="Dismiss error"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-6 text-[#7c89b5] text-xs">
          <Loader2 className="w-4 h-4 animate-spin mr-2" />
          Loading sub-agents…
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[600px] overflow-y-auto scroll-cyan pr-1">
          {rows.map((r) => {
            const Icon = getIcon(r.icon)
            const isCustom = !r.isBuiltin
            return (
              <motion.div
                key={r.id}
                layout
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                className="rounded-md p-3 border transition"
                style={{
                  borderColor: r.enabled ? `${r.color}55` : 'rgba(91,106,146,0.30)',
                  background: r.enabled ? `${r.color}08` : 'rgba(255,255,255,0.015)',
                  opacity: r.enabled ? 1 : 0.6,
                }}
              >
                <div className="flex items-start gap-2">
                  <div
                    className="w-9 h-9 rounded-md flex items-center justify-center border flex-shrink-0"
                    style={{
                      background: `${r.color}15`,
                      borderColor: `${r.color}50`,
                    }}
                  >
                    <Icon className="w-4 h-4" style={{ color: r.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className="text-[12px] font-bold tracking-wider"
                        style={{ color: r.enabled ? r.color : '#7c89b5' }}
                      >
                        {r.name}
                      </span>
                      {r.isBuiltin ? (
                        <span className="text-[8px] px-1 py-0.5 rounded-full bg-cyan-400/10 border border-cyan-400/30 text-cyan-200 tracking-wider">
                          BUILT-IN
                        </span>
                      ) : (
                        <span className="text-[8px] px-1 py-0.5 rounded-full bg-purple-400/10 border border-purple-400/30 text-purple-200 tracking-wider">
                          CUSTOM
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-[#9bb5d4] leading-tight mt-0.5 truncate">
                      {r.role}
                    </div>
                    <div className="text-[9px] text-[#5b6a92] leading-tight mt-0.5 line-clamp-2">
                      {r.specialty}
                    </div>
                  </div>
                </div>

                {/* tools list */}
                <div className="mt-2 flex flex-wrap gap-1">
                  {r.allowedTools.slice(0, 4).map((t) => (
                    <span
                      key={t}
                      className="text-[8px] px-1.5 py-0.5 rounded bg-black/40 border border-cyan-400/15 text-[#9bb5d4]"
                    >
                      {t}
                    </span>
                  ))}
                  {r.allowedTools.length > 4 && (
                    <span className="text-[8px] px-1.5 py-0.5 rounded bg-black/40 border border-cyan-400/15 text-[#5b6a92]">
                      +{r.allowedTools.length - 4} more
                    </span>
                  )}
                </div>

                {/* actions */}
                <div className="mt-2 flex items-center gap-1 flex-wrap">
                  <button
                    onClick={() => onToggle(r)}
                    className={`h-6 px-2 rounded text-[9px] font-semibold tracking-wider flex items-center gap-1 border transition ${
                      r.enabled
                        ? 'bg-emerald-500/10 border-emerald-400/40 text-emerald-200 hover:bg-emerald-500/20'
                        : 'bg-[#3b4768]/20 border-[#3b4768] text-[#7c89b5] hover:bg-[#3b4768]/40'
                    }`}
                    style={{ touchAction: 'manipulation' }}
                    title={r.enabled ? 'Disable' : 'Enable'}
                  >
                    <Power className="w-3 h-3" />
                    {r.enabled ? 'ENABLED' : 'DISABLED'}
                  </button>
                  <button
                    onClick={() => onEditClick(r)}
                    className="h-6 px-2 rounded text-[9px] font-semibold tracking-wider flex items-center gap-1 border border-cyan-400/30 text-cyan-200 hover:bg-cyan-400/10 transition"
                    style={{ touchAction: 'manipulation' }}
                    title="Edit"
                  >
                    <Pencil className="w-3 h-3" />
                    EDIT
                  </button>
                  <button
                    onClick={() => onDelete(r)}
                    className={`h-6 px-2 rounded text-[9px] font-semibold tracking-wider flex items-center gap-1 border transition ${
                      isCustom
                        ? 'border-pink-400/40 text-pink-200 hover:bg-pink-400/10'
                        : 'border-[#3b4768] text-[#5b6a92] cursor-not-allowed opacity-60'
                    }`}
                    disabled={!isCustom}
                    style={{ touchAction: 'manipulation' }}
                    title={
                      isCustom
                        ? 'Delete custom agent'
                        : 'Built-ins cannot be deleted (use DELETE to reset overlay)'
                    }
                  >
                    <Trash2 className="w-3 h-3" />
                    {isCustom ? 'DELETE' : 'BUILT-IN'}
                  </button>
                </div>
              </motion.div>
            )
          })}
        </div>
      )}

      {/* Edit / Create modal */}
      <AnimatePresence>
        {(editing || creating) && (
          <SubagentEditModal
            initial={editing}
            preset={creating ? templatePreset : null}
            onClose={onCloseEdit}
          />
        )}
      </AnimatePresence>
    </section>
  )
}

/* ------------------------------------------------------------------ *
 * SubagentEditModal — handles both creating new and editing existing.
 * If `initial` is null, it's a create flow. Otherwise it's an edit flow.
 * `preset` (only used in create mode) pre-fills the form with a quick-
 * template's values without auto-submitting — the user can tweak first.
 * ------------------------------------------------------------------ */
function SubagentEditModal({
  initial,
  preset,
  onClose,
}: {
  initial: SubagentRow | null
  preset: QuickTemplate['preset'] | null
  onClose: (didMutate: boolean) => void
}) {
  const isCreate = !initial
  const [name, setName] = useState(initial?.name ?? preset?.name ?? '')
  const [role, setRole] = useState(initial?.role ?? preset?.role ?? '')
  const [specialty, setSpecialty] = useState(initial?.specialty ?? preset?.specialty ?? '')
  const [color, setColor] = useState(initial?.color ?? preset?.color ?? '#00f0ff')
  const [icon, setIcon] = useState<string>(initial?.icon ?? preset?.icon ?? 'Sparkles')
  const [allowedTools, setAllowedTools] = useState<string[]>(
    initial?.allowedTools ?? preset?.allowedTools ?? ['web_search', 'page_reader']
  )
  const [systemPrompt, setSystemPrompt] = useState(initial?.systemPrompt ?? preset?.systemPrompt ?? '')
  const [enabled, setEnabled] = useState<boolean>(initial?.enabled ?? true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return
    setError('')
    if (!name.trim()) {
      setError('Name is required.')
      return
    }
    if (systemPrompt.trim().length < 20) {
      setError('System prompt must be at least 20 characters.')
      return
    }
    if (allowedTools.length === 0) {
      setError('Select at least one allowed tool.')
      return
    }
    setSubmitting(true)
    try {
      const body = { name, role, specialty, color, icon, allowedTools, systemPrompt, enabled }
      const url = isCreate
        ? '/api/subagents'
        : `/api/subagents/${encodeURIComponent(initial!.id)}`
      const method = isCreate ? 'POST' : 'PUT'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`)
      onClose(true)
    } catch (e: any) {
      setError(e?.message ?? 'Save failed')
      setSubmitting(false)
    }
  }

  const toggleTool = (t: string) => {
    setAllowedTools((prev) =>
      prev.includes(t) ? prev.filter((p) => p !== t) : [...prev, t]
    )
  }

  const PreviewIcon = getIcon(icon)

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4"
      onClick={() => !submitting && onClose(false)}
    >
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 18, scale: 0.96 }}
        transition={{ duration: 0.2 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-2xl glass-strong sm:rounded-2xl p-5 sm:p-6 min-h-screen sm:min-h-0 overflow-y-auto scroll-cyan"
        style={{ borderColor: 'rgba(0,240,255,0.35)', boxShadow: '0 0 40px rgba(0,240,255,0.15)' }}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <PreviewIcon className="w-5 h-5" style={{ color }} />
            <h2 className="text-base font-bold text-[#e0e7ff]">
              {isCreate ? 'New Custom Sub-Agent' : `Edit: ${initial?.name}`}
            </h2>
          </div>
          <button
            onClick={() => !submitting && onClose(false)}
            className="sm:hidden text-[#7c89b5] hover:text-cyan-300 p-1"
            aria-label="Close"
            style={{ touchAction: 'manipulation' }}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-[11px] text-[#7c89b5] mb-4">
          {isCreate
            ? 'Define a new specialist the Super Agent can dispatch. After creation, it appears in the SUB-AGENT NETWORK panel and can be referenced via <dispatch agent="id" task="..."/>.'
            : 'Edit this sub-agent\'s properties. Built-in agents can be edited via an overlay (original definition preserved); custom agents edit in place.'}
        </p>

        <form onSubmit={onSubmit} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] tracking-[0.2em] text-[#7c89b5] mb-1 font-semibold">NAME *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                className="w-full glass rounded-lg px-3 py-2 text-sm text-[#e0e7ff] outline-none focus:border-cyan-400/70 transition"
                placeholder="e.g. TRADER"
                required
                autoFocus
              />
            </div>
            <div>
              <label className="block text-[10px] tracking-[0.2em] text-[#7c89b5] mb-1 font-semibold">ROLE</label>
              <input
                type="text"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                maxLength={200}
                className="w-full glass rounded-lg px-3 py-2 text-sm text-[#e0e7ff] outline-none focus:border-cyan-400/70 transition"
                placeholder="e.g. Crypto Trading Specialist"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] tracking-[0.2em] text-[#7c89b5] mb-1 font-semibold">SPECIALTY</label>
            <input
              type="text"
              value={specialty}
              onChange={(e) => setSpecialty(e.target.value)}
              maxLength={500}
              className="w-full glass rounded-lg px-3 py-2 text-sm text-[#e0e7ff] outline-none focus:border-cyan-400/70 transition"
              placeholder="e.g. Spot trading, DCA, on-chain analysis"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] tracking-[0.2em] text-[#7c89b5] mb-1 font-semibold">COLOR (HEX)</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="w-10 h-9 rounded-md bg-transparent border border-cyan-400/30 cursor-pointer"
                />
                <input
                  type="text"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="flex-1 glass rounded-lg px-3 py-2 text-sm text-[#e0e7ff] outline-none focus:border-cyan-400/70 transition font-mono"
                  placeholder="#00f0ff"
                />
              </div>
            </div>
            <div>
              <label className="block text-[10px] tracking-[0.2em] text-[#7c89b5] mb-1 font-semibold">ICON (LUCIDE)</label>
              <select
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                className="w-full glass rounded-lg px-3 py-2 text-sm text-[#e0e7ff] outline-none focus:border-cyan-400/70 transition"
              >
                {VALID_ICON_NAMES.map((n) => (
                  <option key={n} value={n} className="bg-black text-[#e0e7ff]">
                    {n}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[10px] tracking-[0.2em] text-[#7c89b5] mb-1 font-semibold">ALLOWED TOOLS</label>
            <div className="flex flex-wrap gap-1.5">
              {ALL_TOOL_OPTIONS.map((t) => {
                const on = allowedTools.includes(t)
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleTool(t)}
                    className={`px-2 py-1 rounded-md text-[10px] font-mono tracking-wider border transition ${
                      on
                        ? 'bg-cyan-400/15 border-cyan-400/50 text-cyan-200'
                        : 'glass border-cyan-400/15 text-[#7c89b5] hover:text-cyan-200'
                    }`}
                    style={{ touchAction: 'manipulation' }}
                  >
                    {on ? '✓ ' : ''}
                    {t}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label className="block text-[10px] tracking-[0.2em] text-[#7c89b5] mb-1 font-semibold">SYSTEM PROMPT *</label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              maxLength={8000}
              rows={6}
              className="w-full glass rounded-lg px-3 py-2 text-xs font-mono text-[#e0e7ff] outline-none focus:border-cyan-400/70 transition resize-y"
              placeholder="You are X, the [role] sub-agent of Agent007 AI. Your specialty: ...&#10;&#10;ALLOWED TOOLS:&#10;- web_search — ...&#10;&#10;OUTPUT FORMAT:&#10;- <thought>...</thought> before each action&#10;- <tool name='...'>{json}</tool> to call a tool&#10;- Plain markdown final answer&#10;&#10;RULES:&#10;- ...&#10;- Max 6 tool calls."
              required
            />
            <div className="text-[9px] text-[#5b6a92] mt-0.5">{systemPrompt.length} / 8000 chars</div>
          </div>

          {!isCreate && (
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="w-4 h-4 accent-cyan-400"
              />
              <span className="text-xs text-[#cfd9f0]">Enabled (dispatchable)</span>
            </label>
          )}

          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-pink-500/10 border border-pink-400/40 text-pink-200 text-xs">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => !submitting && onClose(false)}
              className="flex-1 px-3 py-2 rounded-lg text-xs font-semibold glass border-cyan-400/20 text-[#cfd9f0] hover:border-cyan-400/40 transition"
              style={{ touchAction: 'manipulation' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 neon-btn-cyan rounded-lg py-2 text-xs font-bold tracking-wider flex items-center justify-center gap-2 disabled:opacity-60"
              style={{ touchAction: 'manipulation' }}
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  SAVING…
                </>
              ) : isCreate ? (
                <>
                  <Plus className="w-3.5 h-3.5" />
                  CREATE AGENT
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  SAVE CHANGES
                </>
              )}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  )
}
