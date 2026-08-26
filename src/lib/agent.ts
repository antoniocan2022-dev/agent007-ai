import { db } from '@/lib/db'
import { dispatchTool, type AttachmentMeta, type ToolResult } from '@/lib/tools'
import { recallMemories, formatMemoryForPrompt } from '@/lib/memory'
import { getCanonicalOrganizationPrompt } from './canonical-organization-prompt'
import { runCanonicalLlm } from './canonical-llm-router'
import type { ActiveProviderId } from './provider-control-plane'

/**
 * Compatibility facade for legacy orchestrator imports.
 *
 * The legacy Z.AI/OpenAI-specific provider runtime was removed. All actual
 * model execution now flows through the canonical provider control plane.
 * Parsing/history helpers remain here because the orchestrator still imports
 * them from this module.
 */
export const MAX_ITERATIONS = 50
export const RATE_LIMIT_INFO: { last429At: number | null; retryingNow: boolean } = { last429At: null, retryingNow: false }
const RATE_LIMIT_COOLDOWN_MS = 30_000

export const SYSTEM_PROMPT = `You are Agent007 — Antonio's AI executive partner.

MISSION: Continuously discover, validate, build, launch, optimize, automate, and scale ethical digital businesses that maximize long-term enterprise value while increasing the organization's knowledge, intelligence, trust, autonomy, and recurring revenue.

VISION: An Autonomous AI Enterprise that builds, operates, improves, and manages a portfolio of digital businesses through a shared executive intelligence, continuously increasing its organizational capital, enterprise value, and recurring revenue.

IDENTITY: You are Agent007 — Antonio's autonomous super-agent governed by the canonical organization graph. You are the CEO of a portfolio of digital businesses. Think before you speak, adapt your style to the request, and never claim work, evidence, or verification that did not occur.

TOOL FORMAT: <tool name="web_search">{"query":"..."}</tool>
DISPATCH: <dispatch agent="scout" task="..."/> Max 3 per turn.
DISCOVERY: <tool name="smart_tool_router">{"task":"..."}</tool>
PARALLEL: <tool name="parallel_executor">{"tools":[...]}</tool>

${getCanonicalOrganizationPrompt()}

QUALITY: Auto-scored 0-100. Never fabricate live facts. Distinguish evidence from inference.`

let cachedSystemPrompt: string | null = null
export async function getSystemPrompt(): Promise<string> {
  if (cachedSystemPrompt) return cachedSystemPrompt
  try {
    const { TOOL_REGISTRY } = await import('./tools')
    cachedSystemPrompt = SYSTEM_PROMPT.replaceAll('${TOOL_COUNT}', String(Object.keys(TOOL_REGISTRY).length))
  } catch {
    cachedSystemPrompt = SYSTEM_PROMPT
  }
  return cachedSystemPrompt
}

export interface AgentEventEmit {
  (event: 'thought' | 'tool_call' | 'tool_result' | 'token' | 'memory_update' | 'error' | 'heartbeat' | 'progress' | 'reasoning', data: any): Promise<void> | void
}
export interface AgentRunOptions { conversationId: string; userMessage: string; attachments: AttachmentMeta[]; language: 'en' | 'zh'; emit: AgentEventEmit }
export interface AgentRunResult {
  finalAnswer: string
  steps: Array<{ id: string; thought?: string; toolName?: string; toolArgs?: any; toolResult?: ToolResult; startedAt: number; finishedAt?: number }>
  persistedAssistantMessageId: string
}

export function isRateLimitError(e: any): boolean {
  const status: number | undefined = e?.status ?? e?.response?.status
  if (status === 429) return true
  const lower = String(e?.message ?? e).toLowerCase()
  return lower.includes('429') || lower.includes('too many requests') || lower.includes('rate limit')
}

export function getRateLimitState(): { status: 'ok' | 'rate_limited'; last429At: number | null; cooldownMs: number } {
  const now = Date.now()
  const cooldownUntil = RATE_LIMIT_INFO.last429At ? RATE_LIMIT_INFO.last429At + RATE_LIMIT_COOLDOWN_MS : 0
  return { status: now < cooldownUntil ? 'rate_limited' : 'ok', last429At: RATE_LIMIT_INFO.last429At, cooldownMs: Math.max(0, cooldownUntil - now) }
}

export function wasTruncatedByLength(completion: any): boolean {
  return (completion?.choices?.[0]?.finish_reason ?? completion?.choices?.[0]?.message?.finish_reason) === 'length'
}

export function validateToolArgs(rawArgsString: string | undefined): { ok: boolean; args: any; error?: string } {
  if (!rawArgsString || !rawArgsString.trim()) return { ok: true, args: {} }
  try {
    const parsed = JSON.parse(rawArgsString)
    return { ok: true, args: parsed }
  } catch (e: any) {
    return { ok: false, args: {}, error: `Invalid JSON in tool args: ${e?.message ?? 'parse error'}. Raw: "${rawArgsString.slice(0, 200)}"` }
  }
}

export const THOUGHT_RE = /<thought>([\s\S]*?)<\/thought>/i
export const TOOL_RE = /<tool\s+name=["']([^"']+)["']\s*(?:\/>|>([\s\S]*?)<\/tool>)/i
export const DISPATCH_SUBAGENT_RE = /<dispatch_subagent\s+id=["']([^"']+)["']\s*>([\s\S]*?)<\/dispatch_subagent>/i

export interface Parsed {
  thought?: string
  tool?: { name: string; args: any }
  dispatch?: { agentId: string; task: string }
  textAfterTool: string
  textBeforeTool: string
  raw: string
}

export function parseAssistant(content: string): Parsed {
  const thought = content.match(THOUGHT_RE)?.[1]?.trim()
  const toolMatch = content.match(TOOL_RE)
  const dispatchMatch = content.match(DISPATCH_SUBAGENT_RE)
  let tool: Parsed['tool']
  let dispatch: Parsed['dispatch']
  let textBeforeTool = content.replace(THOUGHT_RE, '').trim()
  let textAfterTool = ''

  if (toolMatch) {
    const name = (toolMatch[1] ?? '').trim()
    let args: any = {}
    const raw = (toolMatch[2] ?? '').trim()
    if (raw) {
      try { args = JSON.parse(raw) }
      catch {
        const recovered: Record<string, string> = {}
        const re = /"([^"]+)"\s*:\s*"([^"]*)"/g
        let match: RegExpExecArray | null
        while ((match = re.exec(raw))) recovered[match[1]] = match[2]
        args = recovered
      }
    }
    tool = { name, args }
    const idx = content.indexOf(toolMatch[0])
    textBeforeTool = content.slice(0, idx).replace(THOUGHT_RE, '').trim()
    textAfterTool = content.slice(idx + toolMatch[0].length).trim()
    if (name === 'dispatch_subagent') {
      const agentId = String(args?.id ?? args?.agentId ?? '').trim()
      const task = String(args?.task ?? args?.goal ?? '').trim()
      if (agentId) dispatch = { agentId, task }
    }
  } else if (dispatchMatch) {
    const agentId = (dispatchMatch[1] ?? '').trim()
    const task = (dispatchMatch[2] ?? '').trim()
    if (agentId) {
      tool = { name: 'dispatch_subagent', args: { id: agentId, task } }
      dispatch = { agentId, task }
      const idx = content.indexOf(dispatchMatch[0])
      textBeforeTool = content.slice(0, idx).replace(THOUGHT_RE, '').trim()
      textAfterTool = content.slice(idx + dispatchMatch[0].length).trim()
    }
  }

  return { thought, tool, dispatch, textBeforeTool, textAfterTool, raw: content }
}

function estimateTokens(messages: Array<{ role: string; content: string }>): number {
  return Math.ceil(messages.reduce((total, message) => total + String(message.content ?? '').length, 0) / 4)
}

export async function buildHistoryMessages(conversationId: string, currentUserMessage: string, currentAttachments: AttachmentMeta[]): Promise<Array<{ role: 'system' | 'user' | 'assistant'; content: string }>> {
  let priorMessages: any[] = []
  try {
    priorMessages = await db.message.findMany({ where: { conversationId }, orderBy: { createdAt: 'asc' } })
  } catch (error: any) {
    console.warn('[buildHistoryMessages] DB query failed:', error?.message?.slice(0, 120))
  }
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = []
  for (const row of priorMessages) {
    if (row.role === 'user') {
      let content = String(row.content ?? '')
      try {
        const attachments = row.attachments ? JSON.parse(row.attachments) as AttachmentMeta[] : []
        const textFiles = attachments.filter((a) => a.textContent)
        const images = attachments.filter((a) => a.mimeType.startsWith('image/'))
        if (textFiles.length) content += `\n\n[ATTACHED TEXT FILES]\n${textFiles.map((a) => `--- ${a.originalName} ---\n${a.textContent?.slice(0, 8000)}`).join('\n\n')}`
        if (images.length) content += `\n\n[ATTACHED IMAGES: ${images.map((a) => a.originalName).join(', ')}] Use the vision tool with image_index to analyze them.`
      } catch {}
      messages.push({ role: 'user', content })
    } else if (row.role === 'assistant') messages.push({ role: 'assistant', content: String(row.content ?? '') })
    else if (row.role === 'tool') messages.push({ role: 'user', content: `[TOOL_RESULT] ${row.toolName}: ${row.toolResult ?? ''}` })
  }

  let userContent = currentUserMessage
  const textFiles = currentAttachments.filter((a) => a.textContent)
  const images = currentAttachments.filter((a) => a.mimeType.startsWith('image/'))
  if (textFiles.length) userContent += `\n\n[ATTACHED TEXT FILES]\n${textFiles.map((a) => `--- ${a.originalName} ---\n${a.textContent?.slice(0, 8000)}`).join('\n\n')}`
  if (images.length) userContent += `\n\n[ATTACHED IMAGES: ${images.map((a) => a.originalName).join(', ')}] Use the vision tool with image_index to analyze them.`
  messages.push({ role: 'user', content: userContent })

  const MAX_TOKENS = 50_000
  const KEEP_TOKENS = 30_000
  if (estimateTokens(messages) > MAX_TOKENS) {
    let kept = 0
    let cutIndex = messages.length
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const tokens = Math.ceil(String(messages[index].content ?? '').length / 4)
      if (kept + tokens > KEEP_TOKENS) { cutIndex = index + 1; break }
      kept += tokens
      cutIndex = index
    }
    return [{ role: 'user', content: '[Earlier conversation history truncated to fit context window.]' }, ...messages.slice(cutIndex)]
  }
  return messages
}

export function chunkText(text: string, size: number): string[] {
  if (!text || size <= 0) return []
  const chunks: string[] = []
  for (let index = 0; index < text.length; index += size) chunks.push(text.slice(index, index + size))
  return chunks
}

export function friendlyLlmError(error: any): string {
  const failures = Array.isArray(error?._failures) ? error._failures : []
  if (failures.length) return `Agent007 provider execution failed.\n\nProviders tried:\n  • ${failures.map((failure: any) => `${failure.provider}: ${failure.isRateLimit ? 'rate limit' : String(failure.error?.message ?? 'failure').slice(0, 120)}`).join('\n  • ')}`
  if (isRateLimitError(error)) return 'Agent007 providers are temporarily rate-limited. Please retry shortly.'
  return `Agent007 provider execution failed: ${String(error?.message ?? error).slice(0, 400)}`
}

/** Canonical model execution compatibility wrapper used by the legacy orchestrator. */
export async function callLlmWithRetry(messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>, opts?: { thinking?: boolean }): Promise<any> {
  RATE_LIMIT_INFO.retryingNow = true
  try {
    const result = await runCanonicalLlm({ messages, thinking: opts?.thinking, taskType: 'reasoning', verification: 'standard', executionClass: 'standard', maxProviderAttempts: 5, timeoutMs: 30_000 })
    RATE_LIMIT_INFO.last429At = null
    return { choices: [{ message: { role: 'assistant', content: result.content, reasoning: undefined }, finish_reason: 'stop' }], _provider: result.provider, _model: result.model, _reasoning: undefined, _attempts: result.attempts }
  } catch (error: any) {
    if (isRateLimitError(error)) RATE_LIMIT_INFO.last429At = Date.now()
    throw error
  } finally {
    RATE_LIMIT_INFO.retryingNow = false
  }
}

export type { ActiveProviderId }
