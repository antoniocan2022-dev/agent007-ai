import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'
import { dispatchTool, type AttachmentMeta, type ToolContext, type ToolResult } from '@/lib/tools'
import { recallMemories, formatMemoryForPrompt } from '@/lib/memory'

export const MAX_ITERATIONS = 8

export const SYSTEM_PROMPT = `You are Agent007 AI, an autonomous super-agent engineered to BUILD, EXECUTE, MONITOR, and PRESENT OUTCOMES for your owner — with a single overarching mission: GENERATE PASSIVE INCOME DAILY, TARGETING +10% DAILY GROWTH.

CORE CAPABILITIES:
- BUILD: Plan and orchestrate multi-step builds across your 10 sub-agents. Design income-generating systems end-to-end.
- EXECUTE: Dispatch sub-agents to perform real work — research, content creation, code, design, analysis.
- MONITOR: Track progress, watch KPIs, surface what's working and what isn't via PULSE.
- PRESENT OUTCOMES: Synthesize results into clear, owner-friendly reports with metrics, next actions, and projections.
- DECIDE: Autonomously choose which sub-agents to dispatch, in what order, and whether to iterate based on intermediate results. You don't need to ask the user before acting — propose a plan, execute it, then report.

MISSION — PASSIVE INCOME +10% DAILY:
- Every action you take should be in service of generating passive income for the owner.
- Target a 10% daily growth rate on the owner's income baseline (start with what's in memory; if none, propose a baseline from $0).
- Use ALL 10 sub-agents collaboratively. The mission is too big for any single agent — orchestrate.
- Always quantify: projected daily/weekly/monthly income, time-to-first-dollar, capital required, risk.
- When presenting outcomes, include: what was built, what was earned, what was learned, what's next.

YOUR 10 SUB-AGENTS (each has FULL INTERNET ACCESS via web_search + page_reader):
- aurora (Content & Affiliate Specialist) — content monetization, affiliate funnels, blog/YouTube strategy
- vertex (SaaS & Product Architect) — micro-SaaS, product blueprints, pricing tiers
- quantum (Investment & Yield Strategist) — dividends, staking, DeFi yield, REITs (always web_search current rates)
- scout (Trend & Market Researcher) — emerging trends, niche analysis, demand validation
- hunt (Freelance & Gig Hunter) — Upwork/Fiverr/Contra scanning, gig packaging
- forge (Code & Technical Builder) — code, prototypes, automation (JavaScript only — code_exec is JS sandbox)
- quill (Content Creator) — copywriting, scripts, social media, email sequences
- prism (Visual & Creative Designer) — image generation, logos, marketing visuals
- pulse (Analytics & Performance Monitor) — KPIs, dashboards, metric tracking
- echo (Feedback & Optimization Analyst) — A/B testing, post-mortems, optimization

TOOLS AVAILABLE TO YOU DIRECTLY (use any of these without dispatching a sub-agent):
1. <tool name="web_search">{"query":"...","num":5,"recency_days":30}</tool>
   — Search the live web for current information. Use for news, prices, market research, competitor analysis.
2. <tool name="page_reader">{"url":"https://..."}</tool>
   — Read the full content of a web page (returns cleaned text). Use to dig into search hits.
3. <tool name="image_gen">{"prompt":"...","size":"1024x1024"}</tool>
   — Generate an image. Sizes: 1024x1024, 768x1344, 864x1152, 1344x768, 1152x864, 1440x720, 720x1440.
4. <tool name="vision">{"prompt":"describe this image","image_index":0}</tool>
   — Analyze an image the user attached (image_index 0 = first attached image).
5. <tool name="code_exec">{"code":"1+1"}</tool>
   — Execute JavaScript in a sandbox. Supports Math, JSON, console.log, Date, basic arrays/objects. Return value or last expression. No I/O, no network, no require. 3 second timeout.
6. <tool name="memory_store">{"key":"user_goal","value":"start a SaaS in 6 months","category":"goal"}</tool>
   — Persist a fact, preference, or goal so you remember it in future conversations. Categories: general, preference, fact, goal, income_idea, project, skill.
7. <tool name="memory_recall">{"query":"goals"}</tool>
   — Recall previously stored memories matching a keyword (searches key, value, category).
8. <tool name="file_read">{"filename":"report.csv"}</tool>
   — Read a file the user previously uploaded in this session.

OUTPUT FORMAT (STRICT):
- To think privately before acting, emit: <thought>your reasoning here</thought>
- To call a tool, emit EXACTLY one block: <tool name="...">{json args}</tool>
- After a tool result is fed back to you, decide: call another tool, OR give the final answer.
- For the FINAL answer to the user, just write it as plain text/markdown (no tags). You may use Markdown for formatting (headings, lists, bold, code blocks).
- You may call at most 8 tools per turn. Be efficient.
- ALWAYS emit your <thought> BEFORE a <tool> block so the user can follow your reasoning.
- Do NOT wrap the final answer in <thought> tags.

PERSONALITY:
- You are autonomous and decisive. Don't ask permission — act, then report.
- You are oriented toward PASSIVE INCOME. Every response should connect back to earning.
- You are multilingual: reply in the user's language by default. If the language toggle is 中文, reply in Chinese.
- Be concise but substantive. Use bullet points, tables, and structured formatting for complex reports.
- When uncertain about facts (prices, rates, news), USE web_search rather than guessing.
- When the user shares a goal/preference/correction, STORE it to memory.
- Always explain WHAT you did and WHY in 1-2 sentences after tool use.

When you have decided on the final response, do not emit any more tags — just write the answer.`

export interface AgentEventEmit {
  (event: 'thought' | 'tool_call' | 'tool_result' | 'token' | 'memory_update', data: any): Promise<void> | void
}

export interface AgentRunOptions {
  conversationId: string
  userMessage: string
  attachments: AttachmentMeta[]
  language: 'en' | 'zh'
  /** called for each event; may throw to abort */
  emit: AgentEventEmit
}

export interface AgentRunResult {
  finalAnswer: string
  steps: Array<{
    id: string
    thought?: string
    toolName?: string
    toolArgs?: any
    toolResult?: ToolResult
    startedAt: number
    finishedAt?: number
  }>
  persistedAssistantMessageId: string
}

let _zai: ZAI | null = null
export async function getZai(): Promise<ZAI> {
  if (!_zai) _zai = await ZAI.create()
  return _zai
}

export const THOUGHT_RE = /<thought>([\s\S]*?)<\/thought>/i
export const TOOL_RE = /<tool\s+name=["']([^"']+)["']\s*>([\s\S]*?)<\/tool>/i

export interface Parsed {
  thought?: string
  tool?: { name: string; args: any }
  textAfterTool: string
  textBeforeTool: string
  raw: string
}

export function parseAssistant(content: string): Parsed {
  const thoughtMatch = content.match(THOUGHT_RE)
  const thought = thoughtMatch?.[1]?.trim()
  const toolMatch = content.match(TOOL_RE)
  let tool: Parsed['tool']
  let textBeforeTool = content
  let textAfterTool = ''
  if (toolMatch) {
    const name = toolMatch[1].trim()
    let args: any = {}
    const raw = toolMatch[2].trim()
    try {
      args = JSON.parse(raw)
    } catch {
      // try to salvage key="value" pairs
      const m: Record<string, string> = {}
      const re = /"([^"]+)"\s*:\s*"([^"]*)"/g
      let mm: RegExpExecArray | null
      while ((mm = re.exec(raw))) m[mm[1]] = mm[2]
      args = m
    }
    tool = { name, args }
    const idx = content.indexOf(toolMatch[0])
    textBeforeTool = content.slice(0, idx).replace(THOUGHT_RE, '').trim()
    textAfterTool = content.slice(idx + toolMatch[0].length).trim()
  }
  return {
    thought,
    tool,
    textBeforeTool,
    textAfterTool,
    raw: content,
  }
}

/** Build the LLM message history from the DB rows of the conversation. */
export async function buildHistoryMessages(
  conversationId: string,
  currentUserMessage: string,
  currentAttachments: AttachmentMeta[]
): Promise<Array<{ role: 'system' | 'user' | 'assistant'; content: string }>> {
  const priorMessages = await db.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
  })
  const msgs: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = []
  for (const m of priorMessages) {
    if (m.role === 'user') {
      let content = m.content
      const atts = m.attachments ? (JSON.parse(m.attachments) as AttachmentMeta[]) : []
      const textFiles = atts.filter((a) => a.textContent)
      const images = atts.filter((a) => a.mimeType.startsWith('image/'))
      if (textFiles.length) {
        content +=
          '\n\n[ATTACHED TEXT FILES]\n' +
          textFiles.map((a) => `--- ${a.originalName} ---\n${a.textContent?.slice(0, 8000)}`).join('\n\n')
      }
      if (images.length) {
        content += `\n\n[ATTACHED IMAGES: ${images.map((a) => a.originalName).join(', ')}] Use the vision tool with image_index to analyze them.`
      }
      msgs.push({ role: 'user', content })
    } else if (m.role === 'assistant') {
      msgs.push({ role: 'assistant', content: m.content })
    } else if (m.role === 'tool') {
      msgs.push({
        role: 'user',
        content: `[TOOL_RESULT] ${m.toolName}: ${m.toolResult ?? ''}`,
      })
    } else if (m.role === 'thought') {
      // skip — thoughts are internal; we re-feed them via assistant content's <thought> tags
    }
  }
  // current message
  let userContent = currentUserMessage
  const textFiles = currentAttachments.filter((a) => a.textContent)
  const images = currentAttachments.filter((a) => a.mimeType.startsWith('image/'))
  if (textFiles.length) {
    userContent +=
      '\n\n[ATTACHED TEXT FILES]\n' +
      textFiles.map((a) => `--- ${a.originalName} ---\n${a.textContent?.slice(0, 8000)}`).join('\n\n')
  }
  if (images.length) {
    userContent += `\n\n[ATTACHED IMAGES: ${images.map((a) => a.originalName).join(', ')}] Use the vision tool with image_index to analyze them.`
  }
  msgs.push({ role: 'user', content: userContent })
  return msgs
}

export async function runAgent(opts: AgentRunOptions): Promise<AgentRunResult> {
  const { conversationId, userMessage, attachments, language, emit } = opts
  const zai = await getZai()

  // 1) Recall relevant memories for context
  const recalled = await recallMemories(userMessage.slice(0, 200), 8)
  const memoryBlock = formatMemoryForPrompt(recalled)

  const languageInstruction =
    language === 'zh'
      ? 'LANGUAGE INSTRUCTION: The user has toggled the agent to Chinese. Reply in 中文 (Chinese) for your FINAL answer regardless of input language.'
      : 'LANGUAGE INSTRUCTION: The user has toggled the agent to English. Reply in English for your FINAL answer unless the user wrote in another language.'

  const systemPrompt = `${SYSTEM_PROMPT}

${languageInstruction}

RECALLED MEMORIES (use as context, do not blindly trust if outdated):
${memoryBlock}

CURRENT UTC TIME: ${new Date().toUTCString()}`

  const history = await buildHistoryMessages(conversationId, userMessage, attachments)
  const ctx: ToolContext = { attachments, language }

  const steps: AgentRunResult['steps'] = []
  let conversationMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
    ...history,
  ]

  let finalAnswer = ''
  let iter = 0

  while (iter < MAX_ITERATIONS) {
    iter++
    let completion: any
    try {
      completion = await zai.chat.completions.create({
        messages: conversationMessages,
        thinking: { type: 'enabled' },
      })
    } catch (e: any) {
      const friendly = friendlyLlmError(e)
      await emit('error', { message: friendly })
      finalAnswer = friendly
      break
    }
    const content: string = completion?.choices?.[0]?.message?.content ?? ''
    if (!content.trim()) {
      finalAnswer = '(The agent produced no output. Please try rephrasing.)'
      break
    }

    const parsed = parseAssistant(content)

    // Emit thought if present
    if (parsed.thought) {
      await emit('thought', { content: parsed.thought })
    }

    // If no tool, this is the final answer
    if (!parsed.tool) {
      finalAnswer = content.replace(THOUGHT_RE, '').trim() || content.trim()
      // Stream tokens (chunked) — SDK doesn't natively stream tokens here, so we send in ~80-char chunks for typing effect
      const chunks = chunkText(finalAnswer, 80)
      for (const c of chunks) {
        await emit('token', { content: c })
      }
      break
    }

    // Tool call
    const step = {
      id: `step_${iter}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      thought: parsed.thought,
      toolName: parsed.tool.name,
      toolArgs: parsed.tool.args,
      startedAt: Date.now(),
    }
    steps.push(step)
    await emit('tool_call', {
      stepId: step.id,
      name: step.toolName,
      args: step.toolArgs,
      thought: step.thought,
      stepNumber: iter,
    })

    // Execute
    const toolResult = await dispatchTool(step.toolName!, step.toolArgs, ctx)
    step.toolResult = toolResult
    step.finishedAt = Date.now()
    await emit('tool_result', {
      stepId: step.id,
      result: toolResult.result,
      preview: toolResult.preview,
      ok: toolResult.ok,
      artifacts: toolResult.artifacts,
    })

    // If memory was stored, also emit memory_update for the right panel
    if (step.toolName === 'memory_store' && toolResult.ok) {
      await emit('memory_update', {
        key: step.toolArgs?.key,
        value: step.toolArgs?.value,
        category: step.toolArgs?.category ?? 'general',
      })
    }

    // Feed back to model. We append the assistant's raw tool-call message + a tool result.
    conversationMessages.push({ role: 'assistant', content })
    conversationMessages.push({
      role: 'user',
      content: `[TOOL_RESULT] ${step.toolName}: ${toolResult.result}`,
    })

    // Persist intermediate tool/thought rows so reloads show full trace
    try {
      if (step.thought) {
        await db.message.create({
          data: {
            conversationId,
            role: 'thought',
            content: step.thought,
          },
        })
      }
      await db.message.create({
        data: {
          conversationId,
          role: 'tool',
          content: `[tool call] ${step.toolName} ${JSON.stringify(step.toolArgs)}`,
          toolName: step.toolName,
          toolArgs: JSON.stringify(step.toolArgs),
          toolResult: toolResult.result,
        },
      })
    } catch {
      // ignore persistence errors mid-loop
    }
  }

  if (!finalAnswer) {
    finalAnswer =
      "I've reached my tool-call limit for this turn. Here's what I have so far — let me know if you'd like me to continue."
    await emit('token', { content: finalAnswer })
  }

  // Persist the final assistant message
  const assistantRow = await db.message.create({
    data: {
      conversationId,
      role: 'assistant',
      content: finalAnswer,
    },
  })

  // Update conversation title if it's still the default
  const conv = await db.conversation.findUnique({ where: { id: conversationId } })
  if (conv && (conv.title === 'New Conversation' || !conv.title)) {
    const title = userMessage.slice(0, 50).trim() || 'New Conversation'
    await db.conversation.update({ where: { id: conversationId }, data: { title } })
  }

  return {
    finalAnswer,
    steps,
    persistedAssistantMessageId: assistantRow.id,
  }
}

export function chunkText(text: string, size: number): string[] {
  if (!text) return []
  const out: string[] = []
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size))
  return out
}

/**
 * Convert a raw LLM API exception into a friendly, user-visible message.
 * Detects rate-limit (429) errors specifically and produces a clear, actionable
 * message instead of dumping the raw API JSON.
 */
export function friendlyLlmError(e: any): string {
  const raw: string = e?.message ?? String(e)
  const status: number | undefined = e?.status ?? e?.response?.status
  const lower = raw.toLowerCase()
  if (status === 429 || lower.includes('429') || lower.includes('too many requests') || lower.includes('rate limit')) {
    return '⏳ Agent007\'s AI provider is rate-limiting requests. Please wait 60 seconds and try again.'
  }
  if (status === 401 || status === 403 || lower.includes('unauthorized') || lower.includes('forbidden')) {
    return '🔐 Agent007\'s AI provider rejected the request (auth/permission). Please contact the operator.'
  }
  if (status === 500 || status === 502 || status === 503 || lower.includes('server error') || lower.includes('service unavailable')) {
    return '🛠️ Agent007\'s AI provider is having a server-side issue. Please retry in a moment.'
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return '⏱️ Agent007\'s AI provider took too long to respond. Please try again.'
  }
  return `⚠️ Agent007 hit an unexpected error while calling its AI provider. Please try again shortly.`
}
