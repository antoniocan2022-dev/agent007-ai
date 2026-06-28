import { create } from 'zustand'
import type { AttachmentMeta } from '@/lib/tools'

export type Lang = 'en' | 'zh'

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

  // ui
  leftOpen: boolean
  rightOpen: boolean
  toggleLeft: () => void
  toggleRight: () => void
  setLeft: (v: boolean) => void
  setRight: (v: boolean) => void
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
  leftOpen: true,
  rightOpen: true,
  abortFlag: { current: false },

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
      for (const r of rows) {
        if (r.role === 'user') {
          // flush pending steps onto the previous assistant if any? They belong to the assistant that follows; skip for now.
          const atts = r.attachments ? safeParseAttachments(r.attachments) : undefined
          messages.push({
            id: r.id,
            role: 'user',
            content: r.content,
            attachments: atts,
            createdAt: new Date(r.createdAt).getTime(),
          })
        } else if (r.role === 'thought') {
          pendingSteps.push({
            id: r.id,
            stepNumber: pendingSteps.length + 1,
            thought: r.content,
            status: 'done',
            startedAt: new Date(r.createdAt).getTime(),
            finishedAt: new Date(r.createdAt).getTime(),
          })
        } else if (r.role === 'tool') {
          pendingSteps.push({
            id: r.id,
            stepNumber: pendingSteps.length + 1,
            toolName: r.toolName,
            toolArgs: r.toolArgs ? safeParseJson(r.toolArgs) : undefined,
            toolResult: r.toolResult ?? '',
            toolPreview: (r.toolResult ?? '').slice(0, 160),
            toolOk: true,
            status: 'done',
            startedAt: new Date(r.createdAt).getTime(),
            finishedAt: new Date(r.createdAt).getTime(),
          })
        } else if (r.role === 'assistant') {
          messages.push({
            id: r.id,
            role: 'assistant',
            content: r.content,
            steps: pendingSteps,
            createdAt: new Date(r.createdAt).getTime(),
          })
          pendingSteps = []
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
  } else if (event === 'token') {
    set((s) => ({
      status: 'streaming',
      messages: s.messages.map((m) =>
        m.id === assistantId
          ? { ...m, content: m.content + (data.content ?? '') }
          : m
      ),
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
  } else if (event === 'error') {
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
    }))
  }
  // 'done' event: nothing special; outer loop will set isStreaming=false
}
