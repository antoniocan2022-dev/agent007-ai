import { db } from '@/lib/db'
import { dispatchTool, type AttachmentMeta, type ToolContext, type ToolResult } from '@/lib/tools'
import { recallMemories, formatMemoryForPrompt } from '@/lib/memory'
import {
  parseAssistant,
  buildHistoryMessages,
  chunkText,
  getZai,
  THOUGHT_RE,
  TOOL_RE,
  SYSTEM_PROMPT as BASE_SYSTEM_PROMPT,
} from '@/lib/agent'
import { SUBAGENTS, getSubagent, runSubagent } from '@/lib/subagents'

export const MAX_ITERATIONS = 8
const MAX_DISPATCHES = 5

/* Regex to find <dispatch agent="..." task="..."/> tags (self-closing).
 * Uses non-greedy [\s\S]*? for the task value so apostrophes / quotes inside the
 * task description don't break the match (the LLM frequently emits apostrophes
 * like 'Quantum Labs' inside the task attribute value). */
const DISPATCH_RE = /<dispatch\s+agent=["']([^"']+)["']\s+task=["']([\s\S]*?)["']\s*\/>/i

interface OrchestratorParsed {
  thought?: string
  tool?: { name: string; args: any }
  dispatch?: { agentId: string; task: string }
  textAfter: string
  raw: string
}

function parseOrchestrator(content: string): OrchestratorParsed {
  const thoughtMatch = content.match(THOUGHT_RE)
  const thought = thoughtMatch?.[1]?.trim()

  const dispatchMatch = content.match(DISPATCH_RE)
  const toolMatch = content.match(TOOL_RE)

  // Prefer dispatch over tool if both somehow present (dispatch has priority)
  if (dispatchMatch) {
    const agentId = dispatchMatch[1].trim().toLowerCase()
    const task = dispatchMatch[2].trim()
    return {
      thought,
      dispatch: { agentId, task },
      textAfter: content.slice(content.indexOf(dispatchMatch[0]) + dispatchMatch[0].length).replace(THOUGHT_RE, '').trim(),
      raw: content,
    }
  }
  if (toolMatch) {
    const name = toolMatch[1].trim()
    let args: any = {}
    const raw = toolMatch[2].trim()
    try {
      args = JSON.parse(raw)
    } catch {
      const m: Record<string, string> = {}
      const re = /"([^"]+)"\s*:\s*"([^"]*)"/g
      let mm: RegExpExecArray | null
      while ((mm = re.exec(raw))) m[mm[1]] = mm[2]
      args = m
    }
    return { thought, tool: { name, args }, textAfter: '', raw: content }
  }
  return { thought, textAfter: content.replace(THOUGHT_RE, '').trim(), raw: content }
}

const ORCHESTRATOR_PROMPT_ADDENDUM = `
SUB-AGENT NETWORK — You are the ORCHESTRATOR of Agent007 AI. You have 10 specialized sub-agents you can dispatch to. Each sub-agent has FULL INTERNET ACCESS (web_search + page_reader) and runs autonomously with its own tools, returning a result. You then synthesize their outputs into a final answer for the owner.

MISSION REMINDER: Every dispatch must serve the +10% daily passive-income growth mission. Choose sub-agents that maximize owner earnings per unit time.

SUB-AGENTS AVAILABLE (all have web_search + page_reader):
- aurora (Content & Affiliate Specialist) — content monetization, affiliate funnels, blog/YouTube strategy
- vertex (SaaS & Product Architect) — micro-SaaS, product blueprints, technical product strategy
- quantum (Investment & Yield Strategist) — passive income via investments, staking, dividends, DeFi
- scout (Trend & Market Researcher) — emerging trends, niche analysis, demand validation
- hunt (Freelance & Gig Hunter) — freelance opportunities, gig scanning, side-hustle discovery
- forge (Code & Technical Builder) — code/prototype/automation tasks
- quill (Content Creator) — copywriting, scripts, marketing content
- prism (Visual & Creative Designer) — image generation, logos, visual assets
- pulse (Analytics & Performance Monitor) — KPI definition, metric tracking, dashboards
- echo (Feedback & Optimization Analyst) — post-mortem analysis, A/B testing, optimization

DISPATCH FORMAT — to delegate a sub-task to a sub-agent, emit exactly one self-closing tag:
<dispatch agent="agent_id" task="clear description of the sub-task" />

Examples:
<dispatch agent="scout" task="Find 3 trending AI niches with high search volume and low competition" />
<dispatch agent="aurora" task="Design a 30-day content calendar for a faceless YouTube channel about AI tools, with monetization strategy" />
<dispatch agent="prism" task="Generate a logo concept for 'Aurora Roasters' coffee brand — minimalist, aurora borealis theme" />
<dispatch agent="forge" task="Write a Node.js script that calculates compound interest given principal, rate, time" />

ORCHESTRATION RULES:
- Decompose complex user requests into sub-tasks. Dispatch the most specialized agent for each sub-task.
- You may dispatch up to 5 sub-agents in one turn (sequentially is fine — each one runs its own loop).
- After each sub-agent returns, you receive its result as: [SUBAGENT_RESULT] agent_id: <their answer>
- You may then dispatch more sub-agents, OR synthesize the final answer.
- The final answer to the user is plain markdown text (no tags). Synthesize all sub-agent outputs into a coherent response with proper attribution (e.g., "📊 Per Scout's research..." or "🎨 Prism generated this concept..."). Always include a brief INCOME PROJECTION in your final answer (daily/weekly/monthly potential).
- You may also call tools DIRECTLY (web_search, memory_store, etc.) for quick lookups without dispatching a sub-agent, if appropriate.
- Max 5 sub-agent dispatches per turn. Be efficient — don't dispatch agents unnecessarily.

DECISION FRAMEWORK:
- Income-related commands → prefer dispatching aurora / vertex / quantum / scout / hunt.
- Implementation commands → prefer forge / quill / prism.
- Analysis commands → prefer pulse / echo.
- Multi-step builds (e.g. "build me a passive-income plan") → dispatch 2-3 sub-agents in sequence: scout first (research), then aurora/vertex (build plan), then pulse (define KPIs).
- Simple questions or small talk → just answer directly without dispatching.
- When in doubt, dispatch — the mission is too big to handle alone.

REMEMBER: Your <tool> blocks still work for direct tool calls. Your <thought> blocks still let the user see your reasoning. <dispatch> is the NEW tag for delegating to a sub-agent.`

export interface OrchestratorEventEmit {
  (event: string, data: any): Promise<void> | void
}

export interface OrchestratorRunOptions {
  conversationId: string
  userMessage: string
  attachments: AttachmentMeta[]
  language: 'en' | 'zh'
  emit: OrchestratorEventEmit
}

export interface OrchestratorRunResult {
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

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export async function runOrchestrator(opts: OrchestratorRunOptions): Promise<OrchestratorRunResult> {
  const { conversationId, userMessage, attachments, language, emit } = opts
  const zai = await getZai()

  // Recall memories for context
  const recalled = await recallMemories(userMessage.slice(0, 200), 8)
  const memoryBlock = formatMemoryForPrompt(recalled)

  const languageInstruction =
    language === 'zh'
      ? 'LANGUAGE INSTRUCTION: The user has toggled the agent to Chinese. Reply in 中文 (Chinese) for your FINAL answer regardless of input language.'
      : 'LANGUAGE INSTRUCTION: The user has toggled the agent to English. Reply in English for your FINAL answer unless the user wrote in another language.'

  const systemPrompt = `${BASE_SYSTEM_PROMPT}

${ORCHESTRATOR_PROMPT_ADDENDUM}

${languageInstruction}

RECALLED MEMORIES (use as context, do not blindly trust if outdated):
${memoryBlock}

CURRENT UTC TIME: ${new Date().toUTCString()}`

  const history = await buildHistoryMessages(conversationId, userMessage, attachments)
  const ctx: ToolContext = { attachments, language }

  const steps: OrchestratorRunResult['steps'] = []
  let conversationMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
    ...history,
  ]

  let finalAnswer = ''
  let iter = 0
  let dispatchCount = 0

  while (iter < MAX_ITERATIONS) {
    iter++
    let completion: any
    try {
      completion = await zai.chat.completions.create({
        messages: conversationMessages,
        thinking: { type: 'enabled' },
      })
    } catch (e: any) {
      const msg = `LLM call failed: ${e?.message ?? String(e)}`
      await emit('error', { message: msg })
      finalAnswer = `⚠️ ${msg}`
      break
    }
    const content: string = completion?.choices?.[0]?.message?.content ?? ''
    if (!content.trim()) {
      finalAnswer = '(The agent produced no output. Please try rephrasing.)'
      break
    }

    const parsed = parseOrchestrator(content)

    // Emit thought
    if (parsed.thought) {
      await emit('thought', { content: parsed.thought })
    }

    // 1) Dispatch path
    if (parsed.dispatch) {
      const { agentId, task } = parsed.dispatch
      const sub = getSubagent(agentId)
      if (!sub) {
        // Unknown agent — feed back an error to the orchestrator
        const errMsg = `Unknown sub-agent: "${agentId}". Available: ${SUBAGENTS.map((s) => s.id).join(', ')}`
        await emit('error', { message: errMsg })
        conversationMessages.push({ role: 'assistant', content })
        conversationMessages.push({ role: 'user', content: `[SUBAGENT_RESULT] ${agentId}: ERROR — ${errMsg}` })
        // Persist the failed dispatch attempt
        try {
          await db.message.create({
            data: {
              conversationId,
              role: 'tool',
              content: `[dispatch:unknown] ${agentId} task="${task}"`,
              toolName: 'subagent_dispatch',
              toolArgs: JSON.stringify({ agentId, task, error: errMsg }),
              toolResult: errMsg,
            },
          })
        } catch { /* ignore */ }
        continue
      }
      if (dispatchCount >= MAX_DISPATCHES) {
        const capMsg = `Reached max sub-agent dispatches (${MAX_DISPATCHES}). Please synthesize the answer from what you have.`
        conversationMessages.push({ role: 'assistant', content })
        conversationMessages.push({ role: 'user', content: `[SYSTEM] ${capMsg}` })
        continue
      }
      dispatchCount++

      const dispatchId = makeId('disp')
      const dispatchStepNumber = iter

      // Emit dispatch event (UI shows the sub-agent header card)
      await emit('subagent_dispatch', {
        dispatchId,
        agentId: sub.id,
        agentName: sub.name,
        color: sub.color,
        icon: sub.icon,
        task,
        stepNumber: dispatchStepNumber,
      })

      // Persist the dispatch row for reload reconstruction
      try {
        await db.message.create({
          data: {
            conversationId,
            role: 'tool',
            content: `[dispatch] ${sub.id} task="${task.slice(0, 200)}"`,
            toolName: 'subagent_dispatch',
            toolArgs: JSON.stringify({ dispatchId, agentId: sub.id, agentName: sub.name, color: sub.color, icon: sub.icon, task }),
            toolResult: null,
          },
        })
      } catch { /* ignore */ }

      // Run the sub-agent (it will emit its own subagent_thought/tool_call/tool_result events)
      let subAnswer = ''
      try {
        const result = await runSubagent({
          subagentId: sub.id,
          task,
          attachments,
          language,
          parentConversationId: conversationId,
          dispatchId,
          emit: async (ev, data) => {
            await emit(ev, data)
            if (ev === 'subagent_complete' && data?.answer) {
              subAnswer = data.answer
            }
          },
        })
        subAnswer = result.answer
      } catch (e: any) {
        subAnswer = `⚠️ Sub-agent ${sub.name} crashed: ${e?.message ?? String(e)}`
        await emit('subagent_complete', { dispatchId, answer: subAnswer })
      }

      // Feed the sub-agent's result back to the orchestrator
      conversationMessages.push({ role: 'assistant', content })
      conversationMessages.push({
        role: 'user',
        content: `[SUBAGENT_RESULT] ${sub.id}: ${subAnswer}`,
      })

      // If a memory_store happened inside the sub-agent, the sub-agent already emitted it
      // (we don't double-emit memory_update here)
      continue
    }

    // 2) Direct tool path (same as the original agent loop)
    if (parsed.tool) {
      const step = {
        id: makeId('step'),
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

      if (step.toolName === 'memory_store' && toolResult.ok) {
        await emit('memory_update', {
          key: step.toolArgs?.key,
          value: step.toolArgs?.value,
          category: step.toolArgs?.category ?? 'general',
        })
      }

      conversationMessages.push({ role: 'assistant', content })
      conversationMessages.push({
        role: 'user',
        content: `[TOOL_RESULT] ${step.toolName}: ${toolResult.result}`,
      })

      // Persist intermediate tool/thought rows for reload reconstruction
      try {
        if (step.thought) {
          await db.message.create({
            data: { conversationId, role: 'thought', content: step.thought },
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
      } catch { /* ignore */ }
      continue
    }

    // 3) Final answer path — emit synthesis signal then stream tokens
    finalAnswer = content.replace(THOUGHT_RE, '').replace(DISPATCH_RE, '').trim() || content.trim()

    // Emit a synthesis indicator so the UI shows "Synthesizing…" briefly
    await emit('synthesis', { content: finalAnswer.slice(0, 80) })

    const chunks = chunkText(finalAnswer, 80)
    for (const c of chunks) {
      await emit('token', { content: c })
    }
    break
  }

  if (!finalAnswer) {
    finalAnswer =
      "I've reached my iteration limit for this turn. Here's what I have so far — let me know if you'd like me to continue."
    await emit('token', { content: finalAnswer })
  }

  // Persist the final assistant message
  const assistantRow = await db.message.create({
    data: { conversationId, role: 'assistant', content: finalAnswer },
  })

  // Update conversation title if it's still default
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

/* Re-export for callers (api/agent/route.ts) that previously used runAgent */
export { parseAssistant }
