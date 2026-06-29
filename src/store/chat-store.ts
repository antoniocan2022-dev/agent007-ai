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

  // ui
  leftOpen: boolean
  rightOpen: boolean
  toggleLeft: () => void
  toggleRight: () => void
  setLeft: (v: boolean) => void
  setRight: (v: boolean) => void

  // active top-level tab
  activeTab: 'chat' | 'dashboard' | 'schedules' | 'settings' | 'missions'
  setActiveTab: (tab: 'chat' | 'dashboard' | 'schedules' | 'settings' | 'missions') => void

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
  /** Re-send the last user message (used by the rate-limit banner's Retry button). */
  retryLastMessage: () => Promise<void>
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
  memories: [],
  activeSubagents: [],
  subagentActivity: {},
  leftOpen: true,
  rightOpen: true,
  abortFlag: { current: false },
  activeTab: 'chat',
  changePasswordOpen: false,
  subagentsVersion: 0,
  rateLimitedUntil: null,

  loadConversations: async () => {
    try {
      const res = await fetch('/api/conversations')
      const data = await safeJson(res)
      set({ conversations: data.conversations ?? [] })
    } catch (e) {
      console.error('loadConversations', e)
    }
  },

  createConversation: async () => {
    const res = await fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New Conversation' }),
    })
    const data = await safeJson(res)
    const conv: ConversationMeta = data.conversation
    set((s) => ({
      conversations: [conv, ...s.conversations],
      currentConversationId: conv.id,
      messages: [],
    }))
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
      const data = await safeJson(res)
      const conv = data.conversation
      if (!conv) {
        set({ messages: [] })
        return
      }
      // Reconstruct messages from DB rows: collapse tool/thought rows under the *next* assistant message
      const rows: any[] = conv.messages ?? []
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
          // Check if this is a sub-agent thought (prefixed with [subagent:id])
          const subMatch = r.content?.match(/^\[subagent:([^\]]+)\]\s*(.*)$/s)
          if (subMatch) {
            const subId = subMatch[1]
            // Find the most recent dispatch for this sub-agent
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
          // Sub-agent dispatch?
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
              // If a subagent_complete row exists for the same dispatchId, the
              // subagentAnswer will be filled below when we encounter that row.
            })
          } else if (r.toolName === 'subagent_complete') {
            const meta = r.toolArgs ? safeParseJson(r.toolArgs) : {}
            // Find the original dispatch step and set the answer
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
            // Reconstruct manage_action step from persisted row
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
            // Regular super-agent tool
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
    set((s) => ({
      messages: [...s.messages, userMsg, assistantMsg],
      status: 'thinking',
      currentTool: null,
      attachments: [],
      abortFlag: { current: false },
      activeSubagents: [],
      subagentActivity: {},
    }))

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
      })
      if (!res.ok || !res.body) {
        const errText = await res.text()
        throw new Error(errText || `HTTP ${res.status}`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      // Track which step is "in progress" so we can mark it done
      let currentStepId: string | null = null

      while (true) {
        if (abortFlag.current) break
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        // SSE messages separated by \n\n
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
            // finish
          }
        }
      }

      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === assistantId ? { ...m, isStreaming: false } : m
        ),
        status: 'idle',
        currentTool: null,
        activeSubagents: [],
      }))
      // Refresh conversation list (title may have changed) + memories
      get().loadConversations()
      get().loadMemories()
    } catch (e: any) {
      console.error('sendMessage error', e)
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                isStreaming: false,
                content:
                  m.content +
                  (m.content ? '\n\n' : '') +
                  `⚠️ **Error:** ${e?.message ?? String(e)}`,
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
    // Find the most recent user message in the current messages list
    const lastUser = [...state.messages].reverse().find((m) => m.role === 'user')
    if (!lastUser) return
    // Clear rate-limit flag so the banner hides immediately
    set({ rateLimitedUntil: null })
    // Put the original attachments back into the store so sendMessage picks
    // them up. Note: data URLs were stripped at upload time, but textContent
    // is preserved so text files still work on retry.
    const atts: AttachmentMeta[] = (lastUser.attachments ?? []).map((a) => ({
      filename: a.filename,
      originalName: a.originalName,
      mimeType: a.mimeType,
      size: a.size,
      dataUrl: a.dataUrl,
      textContent: a.textContent,
    }))
    // Drop the last user message + the failed assistant reply that followed
    // so sendMessage can re-add both cleanly.
    const msgs = state.messages
    const idx = msgs.lastIndexOf(lastUser)
    if (idx >= 0) {
      set({ messages: msgs.slice(0, idx), attachments: atts })
    } else {
      set({ attachments: atts })
    }
    await get().sendMessage(lastUser.content)
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
  if (event === 'thought') {
    set((s) => ({
      status: 'thinking',
      messages: s.messages.map((m) => {
        if (m.id !== assistantId) return m
        const steps = [...(m.steps ?? [])]
        // create a "thinking-only" step so users see the reasoning
        const stepId = `thought_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        steps.push({
          id: stepId,
          stepNumber: steps.length + 1,
          thought: data.content,
          status: 'done',
          startedAt: Date.now(),
          finishedAt: Date.now(),
          kind: 'super_thought',
        })
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
        steps.push({
          id: stepId,
          stepNumber: data.stepNumber ?? steps.length + 1,
          thought: data.thought,
          toolName: data.name,
          toolArgs: data.args,
          status: 'running',
          startedAt: Date.now(),
          kind: 'super_tool',
        })
        return { ...m, steps }
      }),
    }))
  } else if (event === 'tool_result') {
    const stepId = data.stepId
    set((s) => ({
      status: 'thinking',
      currentTool: null,
      messages: s.messages.map((m) => {
        if (m.id !== assistantId) return m
        const steps = (m.steps ?? []).map((st) =>
          st.id === stepId
            ? {
                ...st,
                status: data.ok === false ? 'error' : 'done',
                toolResult: data.result,
                toolPreview: data.preview,
                toolOk: data.ok,
                artifacts: data.artifacts,
                finishedAt: Date.now(),
              }
            : st
        )
        return { ...m, steps }
      }),
    }))
  } else if (event === 'subagent_dispatch') {
    const dispatchId = data.dispatchId
    const agentId = data.agentId
    set((s) => {
      const activeSubagents = s.activeSubagents.includes(dispatchId)
        ? s.activeSubagents
        : [...s.activeSubagents, dispatchId]
      const subagentActivity = { ...s.subagentActivity, [agentId]: 'working' as const }
      return {
        status: 'thinking',
        activeSubagents,
        subagentActivity,
        messages: s.messages.map((m) => {
          if (m.id !== assistantId) return m
          const steps = [...(m.steps ?? [])]
          const stepId = `dispatch_${dispatchId}`
          steps.push({
            id: stepId,
            stepNumber: data.stepNumber ?? steps.length + 1,
            subagentId: agentId,
            subagentName: data.agentName,
            subagentColor: data.color,
            subagentIcon: data.icon,
            subagentTask: data.task,
            dispatchId,
            status: 'running',
            startedAt: Date.now(),
            kind: 'subagent_dispatch',
          })
          return { ...m, steps }
        }),
      }
    })
  } else if (event === 'subagent_thought') {
    const dispatchId = data.dispatchId
    set((s) => ({
      messages: s.messages.map((m) => {
        if (m.id !== assistantId) return m
        const steps = [...(m.steps ?? [])]
        // Find the dispatch step for this dispatchId to get sub-agent info
        const dispatchStep = steps.find(
          (st) => st.dispatchId === dispatchId && st.kind === 'subagent_dispatch'
        )
        const stepId = `subthought_${dispatchId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        steps.push({
          id: stepId,
          stepNumber: steps.length + 1,
          thought: data.content,
          status: 'done',
          startedAt: Date.now(),
          finishedAt: Date.now(),
          kind: 'subagent_thought',
          dispatchId,
          subagentId: dispatchStep?.subagentId,
          subagentName: dispatchStep?.subagentName,
          subagentColor: dispatchStep?.subagentColor,
          subagentIcon: dispatchStep?.subagentIcon,
        })
        return { ...m, steps }
      }),
    }))
  } else if (event === 'subagent_tool_call') {
    const dispatchId = data.dispatchId
    const stepId = data.stepId
    set((s) => ({
      status: 'tool_running',
      currentTool: data.name,
      messages: s.messages.map((m) => {
        if (m.id !== assistantId) return m
        const steps = [...(m.steps ?? [])]
        const dispatchStep = steps.find(
          (st) => st.dispatchId === dispatchId && st.kind === 'subagent_dispatch'
        )
        steps.push({
          id: stepId,
          stepNumber: data.stepNumber ?? steps.length + 1,
          thought: data.thought,
          toolName: data.name,
          toolArgs: data.args,
          status: 'running',
          startedAt: Date.now(),
          kind: 'subagent_tool',
          dispatchId,
          subagentId: dispatchStep?.subagentId,
          subagentName: dispatchStep?.subagentName,
          subagentColor: dispatchStep?.subagentColor,
          subagentIcon: dispatchStep?.subagentIcon,
        })
        return { ...m, steps }
      }),
    }))
  } else if (event === 'subagent_tool_result') {
    const stepId = data.stepId
    set((s) => ({
      status: 'thinking',
      currentTool: null,
      messages: s.messages.map((m) => {
        if (m.id !== assistantId) return m
        const steps = (m.steps ?? []).map((st) =>
          st.id === stepId
            ? {
                ...st,
                status: data.ok === false ? 'error' : 'done',
                toolResult: data.result,
                toolPreview: data.preview,
                toolOk: data.ok,
                artifacts: data.artifacts,
                finishedAt: Date.now(),
              }
            : st
        )
        return { ...m, steps }
      }),
    }))
  } else if (event === 'subagent_complete') {
    const dispatchId = data.dispatchId
    set((s) => {
      const activeSubagents = s.activeSubagents.filter((id) => id !== dispatchId)
      // Mark the sub-agent activity as done (find which agent this dispatchId was for)
      const messages = s.messages.map((m) => {
        if (m.id !== assistantId) return m
        const steps = (m.steps ?? []).map((st) => {
          if (st.dispatchId === dispatchId && st.kind === 'subagent_dispatch') {
            const subagentActivity = { ...s.subagentActivity }
            if (st.subagentId) subagentActivity[st.subagentId] = 'done'
            // Update via the outer set below (this closure can't return both)
            return {
              ...st,
              status: 'done' as const,
              subagentAnswer: data.answer,
              finishedAt: Date.now(),
            }
          }
          return st
        })
        return { ...m, steps }
      })
      // Determine subagent id for activity update
      let agentId: string | undefined
      for (const m of s.messages) {
        if (m.id !== assistantId) continue
        const ds = (m.steps ?? []).find(
          (st) => st.dispatchId === dispatchId && st.kind === 'subagent_dispatch'
        )
        if (ds?.subagentId) {
          agentId = ds.subagentId
          break
        }
      }
      const subagentActivity = { ...s.subagentActivity }
      if (agentId) subagentActivity[agentId] = 'done'
      return { activeSubagents, subagentActivity, messages }
    })
  } else if (event === 'synthesis') {
    set((s) => ({
      status: 'streaming',
      messages: s.messages.map((m) => {
        if (m.id !== assistantId) return m
        const steps = [...(m.steps ?? [])]
        // Push a "synthesizing" marker step (only if not already present)
        const hasSynth = steps.some((st) => st.kind === ('super_thought' as any) && st.thought === '__synthesizing__')
        if (!hasSynth) {
          steps.push({
            id: `synth_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            stepNumber: steps.length + 1,
            thought: '__synthesizing__',
            status: 'thinking',
            startedAt: Date.now(),
            kind: 'super_thought',
          })
        }
        return { ...m, steps }
      }),
    }))
  } else if (event === 'token') {
    set((s) => ({
      status: 'streaming',
      messages: s.messages.map((m) => {
        if (m.id !== assistantId) return m
        // Drop the synthesizing marker step if it exists, since real tokens are now arriving
        const steps = (m.steps ?? []).filter(
          (st) => !(st.kind === 'super_thought' && st.thought === '__synthesizing__')
        )
        return { ...m, content: m.content + (data.content ?? ''), steps }
      }),
    }))
  } else if (event === 'memory_update') {
    // Optimistically add/update memory in the right panel
    set((s) => {
      const exists = s.memories.find((m) => m.key === data.key)
      const item: MemoryItem = {
        id: exists?.id ?? `tmp_${Date.now()}`,
        key: data.key,
        value: data.value,
        category: data.category ?? 'general',
        updatedAt: new Date().toISOString(),
      }
      const memories = exists
        ? s.memories.map((m) => (m.key === data.key ? item : m))
        : [item, ...s.memories]
      return { memories }
    })
  } else if (event === 'manage_action') {
    // Two-phase event: status='running' pushes a new step; status='done'|'error'
    // updates that step with the result.
    const stepId = data.stepId
    if (data.status === 'running') {
      set((s) => ({
        status: 'tool_running',
        currentTool: `manage:${data.action}`,
        messages: s.messages.map((m) => {
          if (m.id !== assistantId) return m
          const steps = [...(m.steps ?? [])]
          steps.push({
            id: stepId,
            stepNumber: data.stepNumber ?? steps.length + 1,
            thought: data.thought,
            status: 'running',
            startedAt: Date.now(),
            kind: 'manage_action',
            manageAction: data.action,
            manageAttrs: data.attrs,
          })
          return { ...m, steps }
        }),
      }))
    } else {
      // done or error
      set((s) => ({
        status: 'thinking',
        currentTool: null,
        messages: s.messages.map((m) => {
          if (m.id !== assistantId) return m
          const steps = (m.steps ?? []).map((st) =>
            st.id === stepId
              ? {
                  ...st,
                  status: data.status === 'error' ? 'error' : 'done',
                  manageResult: data.result,
                  finishedAt: Date.now(),
                }
              : st
          )
          return { ...m, steps }
        }),
      }))
    }
  } else if (event === 'subagents_updated') {
    // The orchestrator created/edited/deleted/toggled a sub-agent. Bump the
    // version so any mounted Sub-Agents panel re-fetches the list. Also
    // refresh memories + conversations (cheap) so the rest of the UI is fresh.
    set((s) => ({ subagentsVersion: s.subagentsVersion + 1 }))
  } else if (event === 'error') {
    const msg: string = (data?.message ?? '').toString()
    const isRateLimit = /rate-?limiting|429|too many requests/i.test(msg)
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === assistantId
          ? {
              ...m,
              content:
                m.content +
                (m.content ? '\n\n' : '') +
                `⚠️ **Error:** ${data.message ?? 'unknown error'}`,
              isStreaming: false,
            }
          : m
      ),
      status: 'idle',
      currentTool: null,
      activeSubagents: [],
      rateLimitedUntil: isRateLimit ? Date.now() + 60_000 : s.rateLimitedUntil,
    }))
  }
  // 'done' event: nothing special; outer loop will set isStreaming=false
}
