import { create } from 'zustand'
import type { AttachmentMeta } from '@/lib/tools'

export type Lang = 'en' | 'zh'

export type ToolStepKind =
  | 'super_thought'
  | 'super_tool'
  | 'subagent_dispatch'
  | 'subagent_thought'
  | 'subagent_tool'
  | 'subagent_complete'
  | 'manage_action'

export interface ToolStep {
  id: string
  stepNumber: number
  thought?: string
  toolName?: string
  toolArgs?: any
  toolResult?: string
  toolPreview?: string
  toolOk?: boolean
  artifacts?: Array<{ type: 'image' | 'text' | 'link'; data: string; label?: string }>
  startedAt: number
  finishedAt?: number
  status: 'thinking' | 'running' | 'done' | 'error'
  /** categorization of this step (super vs sub-agent activity) */
  kind?: ToolStepKind
  /** if this step is from a sub-agent */
  subagentId?: string
  subagentName?: string
  subagentColor?: string
  subagentIcon?: string
  subagentTask?: string
  subagentAnswer?: string
  /** dispatch linkage so subagent_thought/tool_call/tool_result can be grouped */
  dispatchId?: string
  /** UPGRADE #124 — Real Action Verification */
  verified?: boolean  // true = real artifact produced, false = unverified, undefined = not checked
  verificationWarning?: string  // warning message if unverified
  /** if this is a manage_action step */
  manageAction?: string
  manageAttrs?: Record<string, string>
  manageResult?: { ok: boolean; message: string; data?: any }
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  attachments?: AttachmentMeta[]
  steps?: ToolStep[]
  isStreaming?: boolean
  createdAt: number
  /** UPGRADE #119 — LLM reasoning (chain-of-thought) extracted from the response */
  reasoning?: string
}

export interface ConversationMeta {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  _count?: { messages: number }
}

export interface MemoryItem {
  id: string
  key: string
  value: string
  category: string
  updatedAt: string
}

type AgentStatus = 'idle' | 'thinking' | 'tool_running' | 'streaming'

interface ChatState {
  // conversation list
  conversations: ConversationMeta[]
  currentConversationId: string | null
  loadConversations: () => Promise<void>
  createConversation: () => Promise<string>
  selectConversation: (id: string) => Promise<void>
  deleteConversation: (id: string) => Promise<void>

  // messages
  messages: ChatMessage[]
  loadMessages: (conversationId: string) => Promise<void>
  clearMessages: () => void

  // input
  language: Lang
  setLanguage: (l: Lang) => void
  attachments: AttachmentMeta[]
  addAttachment: (a: AttachmentMeta) => void
  removeAttachment: (filename: string) => void
  clearAttachments: () => void

  // agent runtime
  status: AgentStatus
  currentTool: string | null
  // UPGRADE #63 — heartbeat: real-time progress indicator
  // Updated every iteration so the dashboard shows "Working — step 3/50, 2 tools called"
  heartbeat: {
    iteration: number
    maxIterations: number
    toolsCalled: number
    lastToolName: string | null
    lastThought: string | null
    startedAt: number
    elapsedMs: number
    message: string
  } | null
  sendMessage: (text: string) => Promise<void>
  stopStreaming: () => void
  abortFlag: { current: boolean }

  // memories (right panel)
  memories: MemoryItem[]
  loadMemories: () => Promise<void>

  // sub-agent network state
  activeSubagents: string[] // dispatchIds currently running
  subagentActivity: Record<string, 'idle' | 'working' | 'done'> // by sub-agent id (aurora, vertex, ...)
  resetSubagentActivity: () => void
  subagentCount: number // total sub-agents (built-in + custom), fetched from /api/subagents
  loadSubagentCount: () => Promise<void>

  // ui
  leftOpen: boolean
  rightOpen: boolean
  toggleLeft: () => void
  toggleRight: () => void
  setLeft: (v: boolean) => void
  setRight: (v: boolean) => void

  // active top-level tab
  // UPGRADE VID — Added 'vid' tab (Venture Intelligence Division) between Missions and Tracker+.
  // VID is the most powerful department after the CEO — owns venture creation, scoring, and portfolio.
  activeTab: 'chat' | 'dashboard' | 'pods' | 'mission-active' | 'schedules' | 'settings' | 'missions' | 'vid'
  setActiveTab: (tab: 'chat' | 'dashboard' | 'pods' | 'mission-active' | 'schedules' | 'settings' | 'missions' | 'vid') => void

  // global change-password modal trigger (openable from chat-header user menu + Settings tab)
  changePasswordOpen: boolean
  setChangePasswordOpen: (v: boolean) => void

  // subagents panel refresh signal — bumped whenever a manage_action creates/edits/
  // deletes/toggles a sub-agent OR the user manually edits via the Sub-Agents panel.
  // The Sub-Agents tab subscribes to this and re-fetches /api/subagents when it changes.
  subagentsVersion: number
  bumpSubagents: () => void

  // rate-limit UX (#6): when the server emits an error containing "rate-limiting"
  // or "429", we set rateLimitedUntil = now + 60s. The chat-input banner shows a
  // countdown and a "Retry Now" button. When the countdown hits 0, auto-retry.
  rateLimitedUntil: number | null
  // UPGRADE #173 fix #7: serverErrorUntil — used by ProviderErrorBanner
  // (src/components/agent/provider-error-banner.tsx:29) but missing from
  // ChatState. Set to Date.now()+30_000 on 5xx server errors. Same UX
  // as rateLimitedUntil (countdown + retry button) but red instead of amber.
  serverErrorUntil: number | null
  /** Re-send the last user message (used by the rate-limit banner's Retry button). */
  retryLastMessage: () => Promise<void>

  // ─────────────── AUTO-REFRESH SIGNALS ───────────────
  // Agent007 emits refresh signals via /api/system/refresh (data refresh) and
  // /api/system/reload (full page reload) whenever it modifies the dashboard,
  // login, or settings. The client polls /api/system/refresh and bumps
  // refreshVersion whenever the server's lastRefresh timestamp changes.
  // DashboardTab + SettingsTab subscribe to refreshVersion to re-fetch data.
  refreshVersion: number
  lastRefreshTs: string | null
  autoRefreshEnabled: boolean
  setAutoRefreshEnabled: (v: boolean) => void
  startAutoRefresh: () => void
  bumpRefresh: () => void

  // Full-page reload signal — when this changes, the page does window.location.reload()
  reloadVersion: number
  lastReloadTs: string | null
}

let msgIdCounter = 0
function makeId(prefix = 'm'): string {
  msgIdCounter += 1
  return `${prefix}_${Date.now()}_${msgIdCounter}`
}

async function safeJson(res: Response): Promise<any> {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    return { error: text || 'parse error' }
  }
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  currentConversationId: null,
  messages: [],
  language: 'en',
  attachments: [],
  status: 'idle',
  currentTool: null,
  heartbeat: null, // UPGRADE #63 — real-time progress indicator
  memories: [],
  activeSubagents: [],
  subagentActivity: {},
  subagentCount: 12, // default until fetched
  leftOpen: true,
  rightOpen: true,
  abortFlag: { current: false },
  activeTab: 'chat',
  changePasswordOpen: false,
  subagentsVersion: 0,
  rateLimitedUntil: null,
  // UPGRADE #173 fix #7: initialize the new serverErrorUntil field.
  serverErrorUntil: null,
  refreshVersion: 0,
  lastRefreshTs: null,
  autoRefreshEnabled: true,
  reloadVersion: 0,
  lastReloadTs: null,

  loadConversations: async () => {
    try {
      const res = await fetch('/api/conversations')
      if (!res.ok) {
        console.warn('[loadConversations] API returned', res.status)
        // Try localStorage fallback
        if (typeof window !== 'undefined') {
          try {
            const saved = localStorage.getItem('agent007_conversations')
            if (saved) set({ conversations: JSON.parse(saved) })
          } catch {}
        }
        return
      }
      const data = await safeJson(res)
      let convs = data.conversations ?? []
      // UPGRADE #70 — DB is the ONLY source of truth (was: localStorage priority)
      set({ conversations: convs })
      // Also update localStorage as a cache (for offline use only)
      if (typeof window !== 'undefined') {
        try { localStorage.setItem('agent007_conversations', JSON.stringify(convs)) } catch {}
      }
    } catch (e) {
      console.error('loadConversations', e)
      // Fallback: localStorage ONLY if API is unreachable (offline mode)
      if (typeof window !== 'undefined') {
        try {
          const saved = localStorage.getItem('agent007_conversations')
          if (saved) set({ conversations: JSON.parse(saved) })
        } catch {}
      }
    }
  },

  createConversation: async () => {
    let conv: any
    try {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Conversation' }),
      })
      const data = await safeJson(res)
      conv = data.conversation
    } catch {
      conv = {
        id: 'local_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        title: 'New Conversation',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        _count: { messages: 0 },
      }
    }
    set((s) => {
      const newConvs = [conv, ...s.conversations]
      if (typeof window !== 'undefined') {
        try { localStorage.setItem('agent007_conversations', JSON.stringify(newConvs)) } catch {}
      }
      return { conversations: newConvs, currentConversationId: conv.id, messages: [] }
    })
    return conv.id
  },

  selectConversation: async (id) => {
    set({ currentConversationId: id, messages: [] })
    await get().loadMessages(id)
  },

  deleteConversation: async (id) => {
    await fetch(`/api/conversations/${id}`, { method: 'DELETE' })
    set((s) => ({
      conversations: s.conversations.filter((c) => c.id !== id),
      currentConversationId: s.currentConversationId === id ? null : s.currentConversationId,
      messages: s.currentConversationId === id ? [] : s.messages,
    }))
  },

  loadMessages: async (conversationId) => {
    try {
      const res = await fetch(`/api/conversations/${conversationId}`)
      if (!res.ok) {
        console.warn('[loadMessages] API returned', res.status)
        set({ messages: [] })
        return
      }
      const data = await safeJson(res)
      const conv = data.conversation
      if (!conv || !conv.Message || conv.Message.length === 0) {
        // UPGRADE #70 — DB is the ONLY source of truth. No localStorage fallback for messages.
        // Every device sees the SAME messages from Postgres.
        set({ messages: [] })
        return
      }
      // Reconstruct messages from DB rows: collapse tool/thought rows under the *next* assistant message
      const rows: any[] = conv.Message ?? []
      const messages: ChatMessage[] = []
      let pendingSteps: ToolStep[] = []
      // Track open dispatches so subsequent subagent rows can be linked.
      // Map dispatchId → { subagentId, subagentName, subagentColor, subagentIcon, task, stepId }
      const dispatchMap = new Map<string, any>()
      let stepCounter = 0
      for (const r of rows) {
        if (r.role === 'user') {
          const atts = r.attachments ? safeParseAttachments(r.attachments) : undefined
          messages.push({
            id: r.id,
            role: 'user',
            content: r.content,
            attachments: atts,
            createdAt: new Date(r.createdAt).getTime(),
          })
        } else if (r.role === 'thought') {
          const subMatch = r.content?.match(/^\[subagent:([^\]]+)\]\s*([\s\S]*)$/)
          if (subMatch) {
            const subId = subMatch[1]
            let parentDispatch: any = null
            for (const [did, info] of dispatchMap.entries()) {
              if (info.subagentId === subId) parentDispatch = { did, ...info }
            }
            stepCounter++
            pendingSteps.push({
              id: r.id,
              stepNumber: stepCounter,
              thought: subMatch[2],
              status: 'done',
              startedAt: new Date(r.createdAt).getTime(),
              finishedAt: new Date(r.createdAt).getTime(),
              kind: 'subagent_thought',
              dispatchId: parentDispatch?.did,
              subagentId: subId,
              subagentName: parentDispatch?.subagentName,
              subagentColor: parentDispatch?.subagentColor,
              subagentIcon: parentDispatch?.subagentIcon,
            })
          } else {
            stepCounter++
            pendingSteps.push({
              id: r.id,
              stepNumber: stepCounter,
              thought: r.content,
              status: 'done',
              startedAt: new Date(r.createdAt).getTime(),
              finishedAt: new Date(r.createdAt).getTime(),
              kind: 'super_thought',
            })
          }
        } else if (r.role === 'tool') {
          if (r.toolName === 'subagent_dispatch') {
            const meta = r.toolArgs ? safeParseJson(r.toolArgs) : {}
            stepCounter++
            const stepId = `dispatch_${meta.dispatchId ?? r.id}`
            const stepInfo: any = {
              subagentId: meta.agentId,
              subagentName: meta.agentName,
              subagentColor: meta.color,
              subagentIcon: meta.icon,
              task: meta.task,
            }
            if (meta.dispatchId) dispatchMap.set(meta.dispatchId, stepInfo)
            pendingSteps.push({
              id: stepId,
              stepNumber: stepCounter,
              subagentId: meta.agentId,
              subagentName: meta.agentName,
              subagentColor: meta.color,
              subagentIcon: meta.icon,
              subagentTask: meta.task,
              dispatchId: meta.dispatchId,
              status: 'done',
              startedAt: new Date(r.createdAt).getTime(),
              finishedAt: new Date(r.createdAt).getTime(),
              kind: 'subagent_dispatch',
            })
          } else if (r.toolName === 'subagent_complete') {
            const meta = r.toolArgs ? safeParseJson(r.toolArgs) : {}
            const dispatchStep = pendingSteps.find(
              (st) => st.dispatchId === meta.dispatchId && st.kind === 'subagent_dispatch'
            )
            if (dispatchStep) {
              dispatchStep.subagentAnswer = r.toolResult ?? ''
              dispatchStep.status = 'done'
              dispatchStep.finishedAt = new Date(r.createdAt).getTime()
            }
          } else if (r.toolName === 'subagent_tool') {
            const meta = r.toolArgs ? safeParseJson(r.toolArgs) : {}
            const parentDispatch = meta.dispatchId ? dispatchMap.get(meta.dispatchId) : null
            stepCounter++
            pendingSteps.push({
              id: meta.stepId ?? r.id,
              stepNumber: stepCounter,
              toolName: meta.tool,
              toolArgs: meta.args,
              toolResult: r.toolResult ?? '',
              toolPreview: (r.toolResult ?? '').slice(0, 160),
              toolOk: true,
              status: 'done',
              startedAt: new Date(r.createdAt).getTime(),
              finishedAt: new Date(r.createdAt).getTime(),
              kind: 'subagent_tool',
              dispatchId: meta.dispatchId,
              subagentId: parentDispatch?.subagentId ?? meta.agentId,
              subagentName: parentDispatch?.subagentName,
              subagentColor: parentDispatch?.subagentColor,
              subagentIcon: parentDispatch?.subagentIcon,
            })
          } else if (r.toolName === 'manage_action') {
            const meta = r.toolArgs ? safeParseJson(r.toolArgs) : {}
            stepCounter++
            pendingSteps.push({
              id: r.id,
              stepNumber: stepCounter,
              status: 'done',
              startedAt: new Date(r.createdAt).getTime(),
              finishedAt: new Date(r.createdAt).getTime(),
              kind: 'manage_action',
              manageAction: meta.action,
              manageAttrs: meta.attrs,
              manageResult: { ok: !/failed|error/i.test(r.toolResult ?? ''), message: r.toolResult ?? '' },
            })
          } else {
            stepCounter++
            pendingSteps.push({
              id: r.id,
              stepNumber: stepCounter,
              toolName: r.toolName,
              toolArgs: r.toolArgs ? safeParseJson(r.toolArgs) : undefined,
              toolResult: r.toolResult ?? '',
              toolPreview: (r.toolResult ?? '').slice(0, 160),
              toolOk: true,
              status: 'done',
              startedAt: new Date(r.createdAt).getTime(),
              finishedAt: new Date(r.createdAt).getTime(),
              kind: 'super_tool',
            })
          }
        } else if (r.role === 'assistant') {
          messages.push({
            id: r.id,
            role: 'assistant',
            content: r.content,
            steps: pendingSteps,
            createdAt: new Date(r.createdAt).getTime(),
          })
          pendingSteps = []
          stepCounter = 0
          dispatchMap.clear()
        }
      }
      set({ messages })
    } catch (e) {
      console.error('loadMessages', e)
      set({ messages: [] })
    }
  },

  clearMessages: () => set({ messages: [] }),

  setLanguage: (l) => set({ language: l }),

  addAttachment: (a) => set((s) => ({ attachments: [...s.attachments, a] })),
  removeAttachment: (filename) =>
    set((s) => ({ attachments: s.attachments.filter((a) => a.filename !== filename) })),
  clearAttachments: () => set({ attachments: [] }),

  loadMemories: async () => {
    try {
      const res = await fetch('/api/memory')
      const data = await safeJson(res)
      set({ memories: data.memories ?? [] })
    } catch (e) {
      console.error('loadMemories', e)
    }
  },

  resetSubagentActivity: () => set({ activeSubagents: [], subagentActivity: {} }),

  loadSubagentCount: async () => {
    try {
      const res = await fetch('/api/subagents')
      const data = await safeJson(res)
      if (Array.isArray(data.subagents)) {
        set({ subagentCount: data.subagents.length })
      }
    } catch (e) {
      console.error('loadSubagentCount', e)
    }
  },

  sendMessage: async (text) => {
    const trimmed = text.trim()
    if (!trimmed && get().attachments.length === 0) return
    const state = get()
    if (state.status !== 'idle') return

    let conversationId = state.currentConversationId
    if (!conversationId) {
      conversationId = await get().createConversation()
    }

    const userMsg: ChatMessage = {
      id: makeId('u'),
      role: 'user',
      content: trimmed,
      attachments: state.attachments.length ? [...state.attachments] : undefined,
      createdAt: Date.now(),
    }
    const assistantId = makeId('a')
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      steps: [],
      isStreaming: true,
      createdAt: Date.now(),
    }
    set((s) => {
      const newMessages = [...s.messages, userMsg, assistantMsg]
      if (typeof window !== 'undefined') {
        try {
          const convId = s.currentConversationId
          const saved = localStorage.getItem('agent007_conversations')
          if (saved) {
            const convs = JSON.parse(saved)
            const idx = convs.findIndex((c: any) => c.id === convId)
            if (idx >= 0) {
              convs[idx].title = trimmed.slice(0, 50)
              convs[idx].updatedAt = new Date().toISOString()
              localStorage.setItem('agent007_conversations', JSON.stringify(convs))
            }
          }
        } catch {}
      }
      return {
        messages: newMessages,
        status: 'thinking',
        currentTool: null,
        attachments: [],
        abortFlag: { current: false },
        activeSubagents: [],
        subagentActivity: {},
      }
    })

    const abortFlag = get().abortFlag
    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          conversationId,
          attachments: userMsg.attachments ?? [],
          language: state.language,
        }),
        signal: AbortSignal.timeout(290_000),
      })
      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => '')
        if (errText.includes('<!DOCTYPE') || errText.includes('<html')) {
          throw new Error('The server encountered an error. This is usually a temporary database connectivity issue on Vercel. Please wait 10 seconds and try again.')
        }
        throw new Error(errText.slice(0, 200) || `HTTP ${res.status}`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let currentStepId: string | null = null

      while (true) {
        if (abortFlag.current) break
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        let idx: number
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const rawEvent = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)
          const evt = parseSse(rawEvent)
          if (!evt) continue
          applyEvent(evt.event, evt.data, assistantId, set, get, () => {
            currentStepId = evt.data?.stepId ?? currentStepId
          })
          if (evt.event === 'done' || evt.event === 'error') {
            if (_pendingTokens) {
              const remaining = _pendingTokens
              _pendingTokens = ''
              if (_tokenFlushTimer) {
                clearTimeout(_tokenFlushTimer)
                _tokenFlushTimer = null
              }
              set((s) => ({
                messages: s.messages.map((m) => {
                  if (m.id !== assistantId) return m
                  return { ...m, content: m.content + remaining }
                }),
              }))
            }
          }
        }
      }

      set((s) => {
        const newMessages = s.messages.map((m) =>
          m.id === assistantId ? { ...m, isStreaming: false } : m
        )
        if (typeof window !== 'undefined') {
          try {
            const convId = get().currentConversationId
            if (convId) {
              localStorage.setItem('agent007_messages_' + convId, JSON.stringify(newMessages))
            }
          } catch {}
        }
        return {
          messages: newMessages,
          status: 'idle',
          currentTool: null,
          heartbeat: null,
          activeSubagents: [],
        }
      })
      get().loadConversations()
      if (typeof window !== 'undefined') {
        try {
          const convId = get().currentConversationId
          const msgs = get().messages
          if (convId && msgs.length > 0) {
            const firstUserMsg = msgs.find(m => m.role === 'user')
            if (firstUserMsg) {
              const title = firstUserMsg.content.slice(0, 50)
              const saved = localStorage.getItem('agent007_conversations')
              if (saved) {
                const convs = JSON.parse(saved)
                const idx = convs.findIndex((c: any) => c.id === convId)
                if (idx >= 0) {
                  convs[idx].title = title
                  convs[idx].updatedAt = new Date().toISOString()
                  localStorage.setItem('agent007_conversations', JSON.stringify(convs))
                }
              }
            }
          }
        } catch {}
      }
      get().loadMemories()
    } catch (e: any) {
      console.error('sendMessage error', e)
      let errMsg = e?.message ?? String(e)
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
        errMsg = 'The request timed out after 290 seconds. This usually means the LLM providers are slow or the mission is very complex. Click Retry to try again.'
      } else if (errMsg.includes('<!DOCTYPE') || errMsg.includes('<html')) {
        errMsg = 'The server encountered an error. This is usually a temporary database connectivity issue. Please wait 10 seconds and try again.'
      } else if (/fetch failed|ECONNRESET|socket hang up|aborted/i.test(errMsg)) {
        errMsg = 'The connection to the server was interrupted. This usually means the response took too long (Vercel 300-second limit). Click Retry to try again — the agent may respond faster on the next attempt.'
      }
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                isStreaming: false,
                content:
                  m.content +
                  (m.content ? '\n\n' : '') +
                  `⚠️ **Error:** ${errMsg.slice(0, 300)}`,
              }
            : m
        ),
        status: 'idle',
        currentTool: null,
        activeSubagents: [],
      }))
    }
  },

  stopStreaming: () => {
    get().abortFlag.current = true
    set({ status: 'idle', currentTool: null })
  },

  toggleLeft: () => set((s) => ({ leftOpen: !s.leftOpen })),
  toggleRight: () => set((s) => ({ rightOpen: !s.rightOpen })),
  setLeft: (v) => set({ leftOpen: v }),
  setRight: (v) => set({ rightOpen: v }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setChangePasswordOpen: (v) => set({ changePasswordOpen: v }),
  bumpSubagents: () => set((s) => ({ subagentsVersion: s.subagentsVersion + 1 })),

  retryLastMessage: async () => {
    const state = get()
    if (state.status !== 'idle') return
    const lastUser = [...state.messages].reverse().find((m) => m.role === 'user')
    if (!lastUser) return
    set({ rateLimitedUntil: null })
    const atts: AttachmentMeta[] = (lastUser.attachments ?? []).map((a) => ({
      filename: a.filename,
      originalName: a.originalName,
      mimeType: a.mimeType,
      size: a.size,
      dataUrl: a.dataUrl,
      textContent: a.textContent,
    }))
    const msgs = state.messages
    const idx = msgs.lastIndexOf(lastUser)
    if (idx >= 0) {
      set({ messages: msgs.slice(0, idx), attachments: atts })
    } else {
      set({ attachments: atts })
    }
    await get().sendMessage(lastUser.content)
  },

  setAutoRefreshEnabled: (v) => set({ autoRefreshEnabled: v }),
  bumpRefresh: () => set((s) => ({ refreshVersion: s.refreshVersion + 1 })),

  startAutoRefresh: () => {
    if (typeof window === 'undefined') return
    const _g: any = globalThis as any
    if (_g.__agent007AutoRefreshInterval) return
    const poll = async () => {
      const state = get()
      if (!state.autoRefreshEnabled) return
      try {
        const res = await fetch('/api/system/refresh', { signal: AbortSignal.timeout(8000) })
        if (!res.ok) return
        const data = await res.json().catch(() => null)
        if (!data) return
        const serverLastRefresh = data.lastRefresh as string | undefined
        if (serverLastRefresh && serverLastRefresh !== state.lastRefreshTs) {
          set({ lastRefreshTs: serverLastRefresh, refreshVersion: state.refreshVersion + 1 })
        }
        const custom = data.custom ?? {}
        const reloadInfo = custom.__lastReload
        const serverLastReload = reloadInfo?.ts as string | undefined
        if (serverLastReload && serverLastReload !== state.lastReloadTs) {
          set({ lastReloadTs: serverLastReload, reloadVersion: state.reloadVersion + 1 })
          if (state.lastReloadTs !== null) {
            setTimeout(() => {
              if (typeof window !== 'undefined') window.location.reload()
            }, 200)
          }
        }
      } catch {
        // Silent — polling failure is OK
      }
    }
    setTimeout(poll, 5000)
    const interval = setInterval(poll, 30000)
    _g.__agent007AutoRefreshInterval = interval
  },
}))

function safeParseJson(s: string): any {
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}
function safeParseAttachments(s: string): AttachmentMeta[] | undefined {
  try {
    const a = JSON.parse(s)
    if (Array.isArray(a)) return a
  } catch {
    /* ignore */
  }
  return undefined
}

let _pendingTokens = ''
let _tokenFlushTimer: ReturnType<typeof setTimeout> | null = null

function parseSse(raw: string): { event: string; data: any } | null {
  const lines = raw.split('\n')
  let event = 'message'
  let data = ''
  for (const ln of lines) {
    if (ln.startsWith('event:')) event = ln.slice(6).trim()
    else if (ln.startsWith('data:')) data += ln.slice(5).trim()
  }
  try {
    return { event, data: data ? JSON.parse(data) : {} }
  } catch {
    return { event, data: { raw: data } }
  }
}

function applyEvent(
  event: string,
  data: any,
  assistantId: string,
  set: (fn: (s: ChatState) => Partial<ChatState>) => void,
  get: () => ChatState,
  _track: () => void
) {
  if (event === 'reasoning') {
    set((s) => ({
      status: 'thinking',
      messages: s.messages.map((m) => {
        if (m.id !== assistantId) return m
        const existingReasoning = m.reasoning || ''
        const newReasoning = existingReasoning ? `${existingReasoning}\n\n${data.content}` : data.content
        return { ...m, reasoning: newReasoning }
      }),
    }))
    return
  }
  if (event === 'thought') {
    set((s) => ({
      status: 'thinking',
      messages: s.messages.map((m) => {
        if (m.id !== assistantId) return m
        const steps = [...(m.steps ?? [])]
        const stepId = `thought_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        steps.push({ id: stepId, stepNumber: steps.length + 1, thought: data.content, status: 'done', startedAt: Date.now(), finishedAt: Date.now(), kind: 'super_thought' })
        return { ...m, steps }
      }),
    }))
  } else if (event === 'tool_call') {
    const stepId = data.stepId
    set((s) => ({
      status: 'tool_running',
      currentTool: data.name,
      messages: s.messages.map((m) => {
        if (m.id !== assistantId) return m
        const steps = [...(m.steps ?? [])]
        steps.push({ id: stepId, stepNumber: data.stepNumber ?? steps.length + 1, thought: data.thought, toolName: data.name, toolArgs: data.args, status: 'running', startedAt: Date.now(), kind: 'super_tool' })
        return { ...m, steps }
      }),
    }))
  } else if (event === 'tool_result') {
    const stepId = data.stepId
    const verification = data.verified !== undefined ? { verified: data.verified, verificationWarning: data.verificationWarning } : undefined
    set((s) => ({
      status: 'thinking',
      currentTool: null,
      messages: s.messages.map((m) => {
        if (m.id !== assistantId) return m
        const steps = (m.steps ?? []).map((st): ToolStep => st.id === stepId ? { ...st, status: data.ok === false ? 'error' : 'done', toolResult: data.result, toolPreview: data.preview, toolOk: data.ok, artifacts: data.artifacts, finishedAt: Date.now(), verified: verification?.verified, verificationWarning: verification?.verificationWarning } : st)
        return { ...m, steps }
      }),
    }))
  } else if (event === 'subagent_dispatch') {
    const dispatchId = data.dispatchId
    const agentId = data.agentId
    set((s) => {
      const activeSubagents = s.activeSubagents.includes(dispatchId) ? s.activeSubagents : [...s.activeSubagents, dispatchId]
      const subagentActivity = { ...s.subagentActivity, [agentId]: 'working' as const }
      return { status: 'thinking', activeSubagents, subagentActivity, messages: s.messages.map((m) => {
        if (m.id !== assistantId) return m
        const steps = [...(m.steps ?? [])]
        steps.push({ id: `dispatch_${dispatchId}`, stepNumber: data.stepNumber ?? steps.length + 1, subagentId: agentId, subagentName: data.agentName, subagentColor: data.color, subagentIcon: data.icon, subagentTask: data.task, dispatchId, status: 'running', startedAt: Date.now(), kind: 'subagent_dispatch' })
        return { ...m, steps }
      }) }
    })
  } else if (event === 'subagent_thought') {
    const dispatchId = data.dispatchId
    set((s) => ({ messages: s.messages.map((m) => {
      if (m.id !== assistantId) return m
      const steps = [...(m.steps ?? [])]
      const dispatchStep = steps.find((st) => st.dispatchId === dispatchId && st.kind === 'subagent_dispatch')
      const stepId = `subthought_${dispatchId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      steps.push({ id: stepId, stepNumber: steps.length + 1, thought: data.content, status: 'done', startedAt: Date.now(), finishedAt: Date.now(), kind: 'subagent_thought', dispatchId, subagentId: dispatchStep?.subagentId, subagentName: dispatchStep?.subagentName, subagentColor: dispatchStep?.subagentColor, subagentIcon: dispatchStep?.subagentIcon })
      return { ...m, steps }
    }) }))
  } else if (event === 'subagent_tool_call') {
    const dispatchId = data.dispatchId
    const stepId = data.stepId
    set((s) => ({
      status: 'tool_running',
      currentTool: data.name,
      messages: s.messages.map((m) => {
        if (m.id !== assistantId) return m
        const steps = [...(m.steps ?? [])]
        const dispatchStep = steps.find((st) => st.dispatchId === dispatchId && st.kind === 'subagent_dispatch')
        steps.push({ id: stepId, stepNumber: data.stepNumber ?? steps.length + 1, thought: data.thought, toolName: data.name, toolArgs: data.args, status: 'running', startedAt: Date.now(), kind: 'subagent_tool', dispatchId, subagentId: dispatchStep?.subagentId, subagentName: dispatchStep?.subagentName, subagentColor: dispatchStep?.subagentColor, subagentIcon: dispatchStep?.subagentIcon })
        return { ...m, steps }
      }),
    }))
  } else if (event === 'subagent_tool_result') {
    const stepId = data.stepId
    set((s) => ({ status: 'thinking', currentTool: null, messages: s.messages.map((m) => {
      if (m.id !== assistantId) return m
      const steps = (m.steps ?? []).map((st): ToolStep => st.id === stepId ? { ...st, status: data.ok === false ? 'error' : 'done', toolResult: data.result, toolPreview: data.preview, toolOk: data.ok, artifacts: data.artifacts, finishedAt: Date.now() } : st)
      return { ...m, steps }
    }) }))
  } else if (event === 'subagent_complete') {
    const dispatchId = data.dispatchId
    set((s) => {
      const activeSubagents = s.activeSubagents.filter((id) => id !== dispatchId)
      const messages = s.messages.map((m) => {
        if (m.id !== assistantId) return m
        const steps = (m.steps ?? []).map((st): ToolStep => st.dispatchId === dispatchId && st.kind === 'subagent_dispatch' ? { ...st, status: 'done' as const, subagentAnswer: data.answer, finishedAt: Date.now() } : st)
        return { ...m, steps }
      })
      let agentId: string | undefined
      for (const m of s.messages) {
        if (m.id !== assistantId) continue
        const ds = (m.steps ?? []).find((st) => st.dispatchId === dispatchId && st.kind === 'subagent_dispatch')
        if (ds?.subagentId) { agentId = ds.subagentId; break }
      }
      const subagentActivity = { ...s.subagentActivity }
      if (agentId) subagentActivity[agentId] = 'done'
      return { activeSubagents, subagentActivity, messages }
    })
  } else if (event === 'synthesis') {
    set((s) => ({ status: 'streaming', messages: s.messages.map((m) => {
      if (m.id !== assistantId) return m
      const steps = [...(m.steps ?? [])]
      const hasSynth = steps.some((st) => st.kind === ('super_thought' as any) && st.thought === '__synthesizing__')
      if (!hasSynth) steps.push({ id: `synth_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, stepNumber: steps.length + 1, thought: '__synthesizing__', status: 'thinking', startedAt: Date.now(), kind: 'super_thought' })
      return { ...m, steps }
    }) }))
  } else if (event === 'token') {
    _pendingTokens += (data.content ?? '')
    if (!_tokenFlushTimer) {
      _tokenFlushTimer = setTimeout(() => {
        const tokensToAdd = _pendingTokens
        _pendingTokens = ''
        _tokenFlushTimer = null
        if (tokensToAdd) set((s) => ({ status: 'streaming', messages: s.messages.map((m) => {
          if (m.id !== assistantId) return m
          const steps = (m.steps ?? []).filter((st) => !(st.kind === 'super_thought' && st.thought === '__synthesizing__'))
          return { ...m, content: m.content + tokensToAdd, steps }
        }) }))
      }, 100)
    }
  } else if (event === 'answer') {
    // Fast-lane responses are delivered as one authoritative answer event.
    // The previous client handled only token events, so fast-lane responses
    // were generated and persisted server-side but rendered as an empty bubble.
    const content = typeof data?.content === 'string' ? data.content : ''
    if (content) {
      _pendingTokens = ''
      if (_tokenFlushTimer) { clearTimeout(_tokenFlushTimer); _tokenFlushTimer = null }
      set((s) => ({ status: 'streaming', messages: s.messages.map((m) => {
        if (m.id !== assistantId) return m
        const steps = (m.steps ?? []).filter((st) => !(st.kind === 'super_thought' && st.thought === '__synthesizing__'))
        return { ...m, content, steps }
      }) }))
    }
  } else if (event === 'memory_update') {
    set((s) => {
      const exists = s.memories.find((m) => m.key === data.key)
      const item: MemoryItem = { id: exists?.id ?? `tmp_${Date.now()}`, key: data.key, value: data.value, category: data.category ?? 'general', updatedAt: new Date().toISOString() }
      const memories = exists ? s.memories.map((m) => (m.key === data.key ? item : m)) : [item, ...s.memories]
      return { memories }
    })
  } else if (event === 'manage_action') {
    const stepId = data.stepId
    if (data.status === 'running') {
      set((s) => ({ status: 'tool_running', currentTool: `manage:${data.action}`, messages: s.messages.map((m) => {
        if (m.id !== assistantId) return m
        const steps = [...(m.steps ?? [])]
        steps.push({ id: stepId, stepNumber: data.stepNumber ?? steps.length + 1, thought: data.thought, status: 'running', startedAt: Date.now(), kind: 'manage_action', manageAction: data.action, manageAttrs: data.attrs })
        return { ...m, steps }
      }) }))
    } else {
      set((s) => ({ status: 'thinking', currentTool: null, messages: s.messages.map((m) => {
        if (m.id !== assistantId) return m
        const steps = (m.steps ?? []).map((st): ToolStep => st.id === stepId ? { ...st, status: data.status === 'error' ? 'error' : 'done', manageResult: data.result, finishedAt: Date.now() } : st)
        return { ...m, steps }
      }) }))
    }
  } else if (event === 'subagents_updated') {
    set((s) => ({ subagentsVersion: s.subagentsVersion + 1 }))
  } else if (event === 'heartbeat') {
    set((s) => ({ heartbeat: data }))
  } else if (event === 'error') {
    const pendingContent = _pendingTokens
    _pendingTokens = ''
    if (_tokenFlushTimer) { clearTimeout(_tokenFlushTimer); _tokenFlushTimer = null }
    const msg: string = (data?.message ?? '').toString()
    const isRateLimit = data?.rateLimited === true
    const isDBError = /database|prisma|Can't reach|connection|ECONNREFUSED|ETIMEDOUT/i.test(msg)
    const isNetworkError = /fetch failed|network|timeout|ECONNRESET|socket hang up|aborted/i.test(msg)
    let userMessage = data.message ?? 'unknown error'
    if (isDBError && !data.message) userMessage = '⚠️ The database is temporarily unreachable (Vercel cold start). Please wait 10 seconds and click Retry below.'
    else if (isNetworkError && !data.message) userMessage = '⚠️ Network error — a provider was temporarily unreachable. Please click Retry below.'
    else if (isRateLimit && !data.message) userMessage = '⏳ A provider is at capacity. Please wait 30 seconds and click Retry below.'
    else if (!data.message) userMessage = `⚠️ ${msg.slice(0, 300)}\n\nThis may be a temporary issue. Click Retry below to try again.`
    set((s) => ({
      messages: s.messages.map((m) => m.id === assistantId ? { ...m, content: (m.content || '') + (pendingContent ? pendingContent : '') + (m.content || pendingContent ? '\n\n' : '') + `⚠️ **Error:** ${userMessage}`, isStreaming: false } : m),
      status: 'idle', currentTool: null, heartbeat: null, activeSubagents: [], rateLimitedUntil: isRateLimit ? Date.now() + 30_000 : s.rateLimitedUntil,
    }))
  } else if (event === 'done') {
    const pendingContent = _pendingTokens
    _pendingTokens = ''
    if (_tokenFlushTimer) { clearTimeout(_tokenFlushTimer); _tokenFlushTimer = null }
    if (pendingContent) set((s) => ({ messages: s.messages.map((m) => {
      if (m.id !== assistantId) return m
      const steps = (m.steps ?? []).filter((st) => !(st.kind === 'super_thought' && st.thought === '__synthesizing__'))
      return { ...m, content: m.content + pendingContent, steps }
    }) }))
  }
}
