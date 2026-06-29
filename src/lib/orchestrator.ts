import { db } from '@/lib/db'
import { dispatchTool, type AttachmentMeta, type ToolContext, type ToolResult } from '@/lib/tools'
import { recallMemories, formatMemoryForPrompt } from '@/lib/memory'
import {
  parseAssistant,
  buildHistoryMessages,
  chunkText,
  callLlmWithRetry,
  THOUGHT_RE,
  TOOL_RE,
  SYSTEM_PROMPT as BASE_SYSTEM_PROMPT,
  friendlyLlmError,
} from '@/lib/agent'
import { SUBAGENTS, getAllSubagents, runSubagent, type Subagent } from '@/lib/subagents'
// Note: SUBAGENTS import is retained because executeManageAction references it
// (used to detect built-in ids and reject delete on them).
import { getOperatorUserId, getIncomeSettings, setIncomeSettings } from '@/lib/settings'

export const MAX_ITERATIONS = 8
const MAX_DISPATCHES = 5
const MAX_MANAGE_ACTIONS = 5

/* Regex to find <dispatch agent="..." task="..."/> tags (self-closing).
 * Uses non-greedy [\s\S]*? for the task value so apostrophes / quotes inside the
 * task description don't break the match (the LLM frequently emits apostrophes
 * like 'Quantum Labs' inside the task attribute value). */
const DISPATCH_RE = /<dispatch\s+agent=["']([^"']+)["']\s+task=["']([\s\S]*?)["']\s*\/>/i

/* Regex to find <manage action="..." attr="..." ... /> self-closing tags.
 * Captures the full tag string; attribute parsing happens in parseManageTag. */
const MANAGE_RE = /<manage\s+[^>]*?\/>/gi

interface OrchestratorParsed {
  thought?: string
  tool?: { name: string; args: any }
  dispatch?: { agentId: string; task: string }
  manage?: { action: string; attrs: Record<string, string>; raw: string }
  textAfter: string
  raw: string
}

function parseOrchestrator(content: string): OrchestratorParsed {
  const thoughtMatch = content.match(THOUGHT_RE)
  const thought = thoughtMatch?.[1]?.trim()

  const dispatchMatch = content.match(DISPATCH_RE)
  const toolMatch = content.match(TOOL_RE)
  const manageMatch = content.match(MANAGE_RE)

  // Priority: dispatch > manage > tool (manage and dispatch are both "agent actions")
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
  if (manageMatch && manageMatch.length > 0) {
    const tag = manageMatch[0]
    const attrs = parseManageAttrs(tag)
    const action = (attrs.action ?? '').toString().trim().toLowerCase()
    return {
      thought,
      manage: { action, attrs, raw: tag },
      textAfter: content.replace(tag, '').replace(THOUGHT_RE, '').trim(),
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

/** Parse attributes from a <manage .../> tag. Handles key="value" pairs with
 * either single or double quotes. Also supports attribute values containing
 * spaces because the regex is greedy on the quoted portion. */
function parseManageAttrs(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  // Match: attrName="value" or attrName='value'
  // We allow newlines inside the value via [\s\S]*? (non-greedy).
  const re = /([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  let m: RegExpExecArray | null
  while ((m = re.exec(tag))) {
    const key = m[1]
    const val = m[2] ?? m[3] ?? ''
    attrs[key] = val
  }
  return attrs
}

const ORCHESTRATOR_PROMPT_ADDENDUM = `
SUB-AGENT NETWORK — You are the ORCHESTRATOR of Agent007 AI. You have 12 specialized built-in sub-agents you can dispatch to (plus any custom sub-agents the owner has created). Each sub-agent has FULL INTERNET ACCESS (web_search + page_reader + free-data tools) and runs autonomously with its own tools, returning a result. You then synthesize their outputs into a final answer for the owner.

MISSION REMINDER: Every dispatch must serve the +10% daily passive-income growth mission. Choose sub-agents that maximize owner earnings per unit time.

SUB-AGENTS AVAILABLE (all have web_search + page_reader + wikipedia_search + wikipedia_read + free_apis_directory):
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
- legal (Legal & Tax Strategist — USA/Canada) — US federal/state tax law, CRA/Canadian tax, entity formation (LLC/S-corp), cross-border treaties, deductions, write-offs
- banker (The Banker — Banking & Treasury Strategist — USA/Canada) — US & Canadian banks, business accounts, merchant services, credit cards, loans, treasury, FX, FDIC/OSFI regulations

DISPATCH FORMAT — to delegate a sub-task to a sub-agent, emit exactly one self-closing tag:
<dispatch agent="agent_id" task="clear description of the sub-task" />

Examples:
<dispatch agent="scout" task="Find 3 trending AI niches with high search volume and low competition" />
<dispatch agent="aurora" task="Design a 30-day content calendar for a faceless YouTube channel about AI tools, with monetization strategy" />
<dispatch agent="prism" task="Generate a logo concept for 'Aurora Roasters' coffee brand — minimalist, aurora borealis theme" />
<dispatch agent="forge" task="Write a Node.js script that calculates compound interest given principal, rate, time" />
<dispatch agent="legal" task="What are the 2025 US federal tax brackets for self-employed individuals? Cite irs.gov sources." />
<dispatch agent="banker" task="What are the current top US HYSA rates? Cite source URLs." />

ORCHESTRATION RULES:
- Decompose complex user requests into sub-tasks. Dispatch the most specialized agent for each sub-task.
- You may dispatch up to 5 sub-agents in one turn (sequentially is fine — each one runs its own loop).
- After each sub-agent returns, you receive its result as: [SUBAGENT_RESULT] agent_id: <their answer>
- You may then dispatch more sub-agents, OR synthesize the final answer.
- The final answer to the user is plain markdown text (no tags). Synthesize all sub-agent outputs into a coherent response with proper attribution (e.g., "📊 Per Scout's research..." or "🎨 Prism generated this concept..." or "⚖️ Per LEGAL's analysis..."). Always include a brief INCOME PROJECTION in your final answer (daily/weekly/monthly potential).
- You may also call tools DIRECTLY (web_search, memory_store, wikipedia_search, etc.) for quick lookups without dispatching a sub-agent, if appropriate.
- Max 5 sub-agent dispatches per turn. Be efficient — don't dispatch agents unnecessarily.

DECISION FRAMEWORK:
- Income-related commands → prefer dispatching aurora / vertex / quantum / scout / hunt.
- Implementation commands → prefer forge / quill / prism.
- Analysis commands → prefer pulse / echo.
- Legal / tax / compliance questions (US + Canada) → dispatch legal.
- Banking / treasury / credit / loans / FX questions (US + Canada) → dispatch banker.
- Multi-step builds (e.g. "build me a passive-income plan") → dispatch 2-3 sub-agents in sequence: scout first (research), then aurora/vertex (build plan), then pulse (define KPIs).
- Simple questions or small talk → just answer directly without dispatching.
- When in doubt, dispatch — the mission is too big to handle alone.

DASHBOARD MANAGEMENT (REMEMBER — your <manage .../> tags are parsed server-side and executed):
- "add a new sub-agent for X" → emit <manage action="create_agent" name="X" role="..." specialty="..." color="#hex" icon="LucideName" allowed_tools="web_search,page_reader" system_prompt="..."/>
- "remove the QUANTUM agent" → can't delete built-ins; offer to disable via <manage action="toggle_agent" id="quantum" enabled="false"/> instead.
- "change my income goal to $5000" → <manage action="set_income_goal" amount="5000"/>
- "log $100 income from Aurora" → <manage action="log_income" amount="100" source="Aurora" notes="..."/>
- After a <manage .../> tag is executed, the orchestrator feeds back [MANAGE_RESULT] action: success/failed with details. Then you confirm to the user in plain text.

REMEMBER: Your <tool> blocks still work for direct tool calls. Your <thought> blocks still let the user see your reasoning. <dispatch> delegates to a sub-agent. <manage .../> mutates dashboard state.`

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

/* ------------------------------------------------------------------ *
 * Fast-path detection — when the user's message is a CLEAR, unambiguous
 * create_agent request (short, single-intent, matches a strict regex),
 * we skip the LLM round-trip entirely and execute the manage action
 * directly. This makes "create a sub-agent named X" instant and immune
 * to rate-limiting.
 *
 * Returns null when the pattern is not clear enough → fall through to
 * normal LLM orchestration.
 * ------------------------------------------------------------------ */

interface FastPathCreateAgent {
  action: 'create_agent'
  attrs: Record<string, string>
}

/* Match: "create a new sub-agent named 'Cybersecurity A'"
 *        "add an agent called TESTFAST via fast path"
 *        "build a subagent named Foo"
 * Captures the agent name in group 1 (quotes optional). */
const FAST_CREATE_RE =
  /(?:create|add|build)\s+(?:a\s+)?(?:new\s+)?(?:sub-?agent|agent)\s+(?:named|called)\s+["']?([A-Za-z0-9 _\-]+?)["']?(?:[\s.,]|$)/i

/* Match: role="..." / role: '...' / role is "..." / role named "..." */
function extractAttr(message: string, key: string): string | null {
  // key="value" or key='value' or key=value-with-no-spaces
  const kvRe = new RegExp(
    `${key}\\s*(?:=|:)\\s*["']?([^"'\\n,]+?)["']?(?:[\\s,]|$)`,
    'i'
  )
  const m1 = message.match(kvRe)
  if (m1) return m1[1].trim()
  // "role is X" / "role named X" / "specialized in X"
  const phraseRe = new RegExp(
    `${key}\\s+(?:is|named|specialized\\s+in|specialising\\s+in|specialty)\\s+["']?([A-Za-z0-9 _\\-/]+?)["']?(?:[\\s.,]|$)`,
    'i'
  )
  const m2 = message.match(phraseRe)
  if (m2) return m2[1].trim()
  return null
}

function detectFastPathManage(userMessage: string): FastPathCreateAgent | null {
  if (!userMessage || userMessage.length > 500) return null
  // Require an explicit "fast path" hint OR a very clear single-intent command.
  // The "fast path" hint lets users opt in; we also accept very-short clear
  // commands without the hint.
  const hasFastHint = /\bfast[\s-]?path\b/i.test(userMessage)
  const m = userMessage.match(FAST_CREATE_RE)
  if (!m) return null
  const name = m[1].trim()
  if (!name || name.length < 2 || name.length > 80) return null

  // If the message contains words suggesting other actions (dispatch, delete,
  // log, schedule, set goal, etc.), DON'T fast-path — let the LLM handle it.
  const otherActions =
    /\b(?:dispatch|delete|remove|toggle|disable|enable|log\s+\$|log\s+income|set\s+(?:my\s+)?(?:income|growth|daily)|create\s+schedule|update\s+settings)\b/i.test(
      userMessage
    )
  if (otherActions) return null

  // Without the fast-path hint, require very short messages to avoid
  // over-eager matching on long descriptive requests.
  if (!hasFastHint && userMessage.length > 200) return null

  const attrs: Record<string, string> = { name }
  const role = extractAttr(userMessage, 'role')
  if (role) attrs.role = role
  const specialty = extractAttr(userMessage, 'specialty')
  if (specialty) attrs.specialty = specialty
  const color = extractAttr(userMessage, 'color')
  if (color) attrs.color = color
  const icon = extractAttr(userMessage, 'icon')
  if (icon) attrs.icon = icon
  const systemPrompt = extractAttr(userMessage, 'system_prompt')
  if (systemPrompt) attrs.system_prompt = systemPrompt
  const allowedTools = extractAttr(userMessage, 'allowed_tools')
  if (allowedTools) attrs.allowed_tools = allowedTools

  // If user provided a "specialized in X" phrase but no role, derive a role
  if (!attrs.role) {
    const specMatch = userMessage.match(
      /specialized\s+in\s+([A-Za-z0-9 _\-/]+?)(?:[\s.,]|$)/i
    )
    if (specMatch) {
      attrs.specialty = specMatch[1].trim()
      attrs.role = specMatch[1].trim() + ' Specialist'
    }
  }

  // Fast-path defaults so the action can succeed without forcing the user to
  // specify everything. The user can always edit afterwards via the panel.
  if (!attrs.role) {
    attrs.role = `${name} Specialist`
  }
  if (!attrs.specialty) {
    attrs.specialty = `Custom specialist created via fast-path`
  }
  if (!attrs.allowed_tools) {
    // Sensible default: read-only research tools
    attrs.allowed_tools = 'web_search,page_reader,wikipedia_search,wikipedia_read,free_apis_directory,memory_store,memory_recall'
  }
  if (!attrs.system_prompt) {
    attrs.system_prompt = `You are ${name.toUpperCase()}, a custom specialist sub-agent of Agent007 AI.\n\nYour role: ${attrs.role}.\nYour specialty: ${attrs.specialty}.\n\nALLOWED TOOLS:\n- web_search — Google-style search for current info\n- page_reader — read full web pages\n- memory_store / memory_recall — persist + recall context\n- wikipedia_search / wikipedia_read — encyclopedic background\n- free_apis_directory — find public data APIs\n\nOUTPUT FORMAT:\n- <thought>brief reasoning</thought> before each action\n- <tool name="...">{json}</tool> to call a tool\n- Plain markdown final answer\n\nRULES:\n- Be concise and structured.\n- Cite sources for any factual claim.\n- Max 6 tool calls per turn.`
  }

  return { action: 'create_agent', attrs }
}

/** Execute a fast-path create_agent without invoking the LLM. */
async function runFastPathManage(opts: {
  conversationId: string
  userMessage: string
  language: 'en' | 'zh'
  emit: OrchestratorEventEmit
  fastPath: FastPathCreateAgent
}): Promise<OrchestratorRunResult> {
  const { conversationId, userMessage, emit, fastPath } = opts
  const { action, attrs } = fastPath

  // Persist the user message + an empty assistant row up-front so the timeline
  // and DB stay consistent.
  const assistantRow = await db.message.create({
    data: { conversationId, role: 'assistant', content: '' },
  })

  await emit('thought', {
    content:
      '⚡ Fast-path: detected clear create_agent request, executing without LLM round-trip',
  })

  const stepId = makeId('manage')
  await emit('manage_action', {
    stepId,
    action,
    attrs,
    thought: 'Fast-path create_agent (no LLM round-trip)',
    stepNumber: 1,
    status: 'running',
    fastPath: true,
  })

  // Persist a PendingManageAction row before executing
  let pendingId: string | null = null
  try {
    const userId = await getOperatorUserId()
    if (userId) {
      const row = await db.pendingManageAction.create({
        data: {
          userId,
          action,
          attrs: JSON.stringify(attrs),
          status: 'executing',
        },
      })
      pendingId = row.id
    }
  } catch (e) {
    console.error('[orchestrator:fast-path] failed to persist pending action:', e)
  }

  const result = await executeManageAction(action, attrs)

  // Update the pending row with the result
  if (pendingId) {
    try {
      await db.pendingManageAction.update({
        where: { id: pendingId },
        data: {
          status: result.ok ? 'done' : 'failed',
          result: result.message,
        },
      })
    } catch {
      /* ignore */
    }
  }

  await emit('manage_action', {
    stepId,
    action,
    attrs,
    result,
    stepNumber: 1,
    status: result.ok ? 'done' : 'error',
    fastPath: true,
  })

  // Persist a tool/thought trace for reload reconstruction
  try {
    await db.message.create({
      data: {
        conversationId,
        role: 'tool',
        content: `[manage:${action}] ${JSON.stringify(attrs).slice(0, 200)}`,
        toolName: 'manage_action',
        toolArgs: JSON.stringify({ action, attrs, fastPath: true }),
        toolResult: result.message,
      },
    })
  } catch {
    /* ignore */
  }

  if (
    result.ok &&
    ['create_agent', 'edit_agent', 'delete_agent', 'toggle_agent'].includes(action)
  ) {
    await emit('subagents_updated', { action, attrs, result, fastPath: true })
  }

  // Build a confirmation message and stream it as tokens
  const agentName = attrs.name ?? 'agent'
  const roleLine = attrs.role ? ` (${attrs.role})` : ''
  let finalAnswer: string
  if (result.ok) {
    finalAnswer = `✅ Created sub-agent "${agentName}"${roleLine} via fast-path. Use the Sub-Agents panel to verify or edit it.`
  } else {
    finalAnswer = `⚠️ Fast-path create_agent for "${agentName}" failed: ${result.message}`
  }

  const chunks = chunkText(finalAnswer, 80)
  for (const c of chunks) {
    await emit('token', { content: c })
  }

  // Update the assistant row with the final answer
  try {
    await db.message.update({
      where: { id: assistantRow.id },
      data: { content: finalAnswer },
    })
  } catch {
    /* ignore */
  }

  // Update conversation title
  try {
    const conv = await db.conversation.findUnique({ where: { id: conversationId } })
    if (conv && (conv.title === 'New Conversation' || !conv.title)) {
      const title = userMessage.slice(0, 50).trim() || 'New Conversation'
      await db.conversation.update({ where: { id: conversationId }, data: { title } })
    }
  } catch {
    /* ignore */
  }

  return {
    finalAnswer,
    steps: [],
    persistedAssistantMessageId: assistantRow.id,
  }
}

export async function runOrchestrator(opts: OrchestratorRunOptions): Promise<OrchestratorRunResult> {
  const { conversationId, userMessage, attachments, language, emit } = opts

  // 0a) Replay any pending manage actions left over from prior failed runs.
  //     We surface them as `manage_action` events (status=done|error) so the
  //     UI timeline shows what was (re)executed.
  try {
    const userId = await getOperatorUserId()
    if (userId) {
      const pending = await db.pendingManageAction.findMany({
        where: { userId, status: { in: ['pending', 'executing'] } },
        orderBy: { createdAt: 'asc' },
        take: 10,
      })
      for (const p of pending) {
        try {
          const attrs = JSON.parse(p.attrs) as Record<string, string>
          await emit('manage_action', {
            stepId: `replay_${p.id}`,
            action: p.action,
            attrs,
            thought: 'Replaying pending action from a prior interrupted run',
            stepNumber: 0,
            status: 'running',
            replay: true,
          })
          const result = await executeManageAction(p.action, attrs)
          await db.pendingManageAction.update({
            where: { id: p.id },
            data: {
              status: result.ok ? 'done' : 'failed',
              result: result.message,
            },
          })
          await emit('manage_action', {
            stepId: `replay_${p.id}`,
            action: p.action,
            attrs,
            result,
            stepNumber: 0,
            status: result.ok ? 'done' : 'error',
            replay: true,
          })
        } catch (replayErr: any) {
          await db.pendingManageAction.update({
            where: { id: p.id },
            data: { status: 'failed', result: replayErr?.message ?? 'replay error' },
          })
        }
      }
    }
  } catch (replayOuterErr) {
    // Non-fatal — keep going with the new user message
    console.error('[orchestrator] pending replay failed:', replayOuterErr)
  }

  // 0b) Fast-path: detect a clear, unambiguous create_agent request and
  //     execute it directly without an LLM round-trip. Saves time, tokens,
  //     and sidesteps any rate-limit hit entirely.
  const fastPath = detectFastPathManage(userMessage)
  if (fastPath) {
    return runFastPathManage({
      conversationId,
      userMessage,
      language,
      emit,
      fastPath,
    })
  }

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
  let manageCount = 0
  // Cache the merged subagent list once per orchestrator run (12 built-in + custom + overlays).
  let mergedSubagents: Subagent[] | null = null
  const getMerged = async (): Promise<Subagent[]> => {
    if (!mergedSubagents) mergedSubagents = await getAllSubagents({ includeDisabled: true })
    return mergedSubagents
  }

  while (iter < MAX_ITERATIONS) {
    iter++
    let completion: any
    try {
      completion = await callLlmWithRetry(conversationMessages)
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

    const parsed = parseOrchestrator(content)

    // Emit thought
    if (parsed.thought) {
      await emit('thought', { content: parsed.thought })
    }

    // 0) Manage path — parse <manage .../> tags and execute server-side.
    if (parsed.manage) {
      const { action, attrs } = parsed.manage
      if (manageCount >= MAX_MANAGE_ACTIONS) {
        const capMsg = `Reached max manage actions (${MAX_MANAGE_ACTIONS}). Please synthesize the answer from what you have.`
        conversationMessages.push({ role: 'assistant', content })
        conversationMessages.push({ role: 'user', content: `[SYSTEM] ${capMsg}` })
        continue
      }
      manageCount++

      const stepId = makeId('manage')
      await emit('manage_action', {
        stepId,
        action,
        attrs,
        thought: parsed.thought,
        stepNumber: iter,
        status: 'running',
      })

      // Persist a PendingManageAction row before executing (so we can replay
      // if this run crashes mid-flight).
      let pendingId: string | null = null
      try {
        const userId = await getOperatorUserId()
        if (userId) {
          const row = await db.pendingManageAction.create({
            data: {
              userId,
              action,
              attrs: JSON.stringify(attrs),
              status: 'executing',
            },
          })
          pendingId = row.id
        }
      } catch (e) {
        console.error('[orchestrator] failed to persist pending action:', e)
      }

      const result = await executeManageAction(action, attrs)
      // Refresh the merged subagent list so subsequent dispatches see the new state.
      mergedSubagents = null

      // Update the pending row with the result
      if (pendingId) {
        try {
          await db.pendingManageAction.update({
            where: { id: pendingId },
            data: {
              status: result.ok ? 'done' : 'failed',
              result: result.message,
            },
          })
        } catch {
          /* ignore */
        }
      }

      await emit('manage_action', {
        stepId,
        action,
        attrs,
        result,
        stepNumber: iter,
        status: result.ok ? 'done' : 'error',
      })

      // Persist for reload reconstruction
      try {
        await db.message.create({
          data: {
            conversationId,
            role: 'tool',
            content: `[manage:${action}] ${JSON.stringify(attrs).slice(0, 200)}`,
            toolName: 'manage_action',
            toolArgs: JSON.stringify({ action, attrs }),
            toolResult: result.message,
          },
        })
      } catch { /* ignore */ }

      // If a subagent was created/edited/deleted/toggled, tell the client to refresh its UI.
      if (
        result.ok &&
        ['create_agent', 'edit_agent', 'delete_agent', 'toggle_agent'].includes(action)
      ) {
        await emit('subagents_updated', { action, attrs, result })
      }

      // Feed back the result so the orchestrator can confirm to the user.
      conversationMessages.push({ role: 'assistant', content })
      conversationMessages.push({
        role: 'user',
        content: `[MANAGE_RESULT] ${action}: ${result.ok ? 'success' : 'failed'} — ${result.message}`,
      })
      continue
    }

    // 1) Dispatch path
    if (parsed.dispatch) {
      const { agentId, task } = parsed.dispatch
      const list = await getMerged()
      const sub = list.find((s) => s.id === agentId)
      if (!sub) {
        // Unknown agent — feed back an error to the orchestrator
        const errMsg = `Unknown sub-agent: "${agentId}". Available: ${list.map((s) => s.id).join(', ')}`
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
      if (sub.enabled === false) {
        const errMsg = `Sub-agent "${sub.name}" is currently disabled. Re-enable it via the Sub-Agents panel or the toggle_agent manage tag.`
        await emit('error', { message: errMsg })
        conversationMessages.push({ role: 'assistant', content })
        conversationMessages.push({ role: 'user', content: `[SUBAGENT_RESULT] ${agentId}: ERROR — ${errMsg}` })
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
        subAnswer = friendlyLlmError(e)
        await emit('subagent_complete', { dispatchId, answer: subAnswer })
      }

      // Feed the sub-agent's result back to the orchestrator
      conversationMessages.push({ role: 'assistant', content })
      conversationMessages.push({
        role: 'user',
        content: `[SUBAGENT_RESULT] ${sub.id}: ${subAnswer}`,
      })

      // BEST-EFFORT auto-logging: if the sub-agent's answer mentions dollar
      // amounts (e.g. "$12.50", "$1,200/mo", "$45/day"), log them as income
      // entries with source = sub-agent id. Fire-and-forget — never blocks the
      // orchestrator. We only consider amounts that look like earnings (positive
      // dollar values, optionally followed by /day /mo /week /month).
      try {
        autoLogIncomeFromAnswer(sub.id, subAnswer)
      } catch {
        /* ignore */
      }

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

  // Notification hook: if mission_complete notifications are enabled, send
  // (or log) an email to the operator with the conversation title + preview.
  try {
    const { getNotificationSettings, recentlyNotified } = await import('@/lib/settings')
    const notif = await getNotificationSettings()
    const looksLikeError = /^⚠️|error|failed|crashed/i.test(finalAnswer.slice(0, 50))
    const eventType = looksLikeError ? 'mission_failed' : 'mission_complete'
    if (notif.enabled && notif.events[eventType as keyof typeof notif.events]) {
      if (!(await recentlyNotified(eventType, notif.minDelayMinutes))) {
        const { sendEmail } = await import('@/lib/email')
        const { getOperatorUserId } = await import('@/lib/settings')
        const userId = await getOperatorUserId()
        const convTitle = conv?.title ?? 'Mission'
        const preview = finalAnswer.slice(0, 500)
        sendEmail({
          to: notif.email,
          subject: looksLikeError
            ? `Mission Failed: ${convTitle}`
            : `Mission Complete: ${convTitle}`,
          body: looksLikeError
            ? `Agent007 encountered an issue while running a mission.\n\nConversation: ${convTitle}\n\nPreview:\n${preview}\n\nOpen the dashboard at / to investigate.`
            : `Agent007 has completed a mission.\n\nConversation: ${convTitle}\n\nResult preview:\n${preview}\n\nOpen the dashboard at / to view the full report.`,
          userId: userId ?? undefined,
          type: eventType,
        }).catch(() => {/* ignore */})
      }
    }
  } catch {
    /* ignore notification errors */
  }

  return {
    finalAnswer,
    steps,
    persistedAssistantMessageId: assistantRow.id,
  }
}

/* ------------------------------------------------------------------ *
 * Auto-logging helpers
 * ------------------------------------------------------------------ */

/**
 * Scan a sub-agent's answer for dollar amounts that look like earnings, and
 * log them as IncomeEntry rows with source = agentId. Fire-and-forget.
 *
 * We're deliberately conservative — only log amounts that appear near income
 * keywords (earned, income, revenue, MRR, /day, /mo, /week, /month, profit,
 * ROI, yield). This avoids logging "$0 cost" or "$1,000 capital" as income.
 */
function autoLogIncomeFromAnswer(agentId: string, answer: string): void {
  if (!answer || typeof answer !== 'string') return
  // Strip code blocks to avoid logging amounts from code samples
  const cleaned = answer.replace(/```[\s\S]*?```/g, ' ')
  // Find all $X or $X.Y or $X,YYY mentions
  const re = /\$([\d,]+(?:\.\d{1,2})?)\s*(?:\/(?:day|d|mo|month|m|week|wk|w|year|yr|y))?/gi
  const incomeKeywords = /(earned|income|revenue|mrr|arr|profit|yield|roi|royalt|paying|paid|generat)/i
  const periodKeywords = /\/(day|d|mo|month|m|week|wk|w|year|yr|y)\b/i
  let m: RegExpExecArray | null
  const candidates: Array<{ amount: number; line: string }> = []
  while ((m = re.exec(cleaned))) {
    const amountStr = m[1].replace(/,/g, '')
    const amount = parseFloat(amountStr)
    if (!isFinite(amount) || amount <= 0 || amount > 1_000_000) continue
    // Look at a window of text around this match for income keywords
    const start = Math.max(0, m.index - 80)
    const end = Math.min(cleaned.length, m.index + m[0].length + 80)
    const window = cleaned.slice(start, end)
    // If the amount has a period suffix (/day /mo etc.) OR nearby income keyword → log it
    if (periodKeywords.test(m[0]) || incomeKeywords.test(window)) {
      candidates.push({ amount, line: m[0] })
    }
  }
  if (!candidates.length) return
  // Cap to 3 per sub-agent answer to avoid spamming the table
  const toLog = candidates.slice(0, 3)
  // Fire-and-forget DB inserts
  ;(async () => {
    try {
      const { db } = await import('@/lib/db')
      const now = new Date()
      for (const c of toLog) {
        await db.incomeEntry.create({
          data: {
            amount: c.amount,
            source: agentId.charAt(0).toUpperCase() + agentId.slice(1),
            notes: `Auto-logged from ${agentId} sub-agent answer: "${c.line}"`,
            date: now,
          },
        })
      }
    } catch (e) {
      console.error('[orchestrator] autoLogIncomeFromAnswer failed:', e)
    }
  })()
}

/* Re-export for callers (api/agent/route.ts) that previously used runAgent */
export { parseAssistant }

/* ------------------------------------------------------------------ *
 * Manage-action executor — parses the Super Agent's <manage .../> tags
 * and applies the corresponding change directly to the DB (no HTTP self-
 * calls). Returns a structured result that's emitted as the `manage_action`
 * SSE event AND fed back to the orchestrator as [MANAGE_RESULT] ... .
 * ------------------------------------------------------------------ */

interface ManageResult {
  ok: boolean
  message: string
  data?: any
}

const BUILTIN_IDS = new Set(SUBAGENTS.map((s) => s.id))

const VALID_TOOLS_SET = new Set([
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
])

const VALID_ICONS_SET = new Set([
  'Sparkles', 'Box', 'TrendingUp', 'Search', 'Crosshair', 'Hammer', 'PenLine',
  'Palette', 'Activity', 'RefreshCw', 'Scale', 'Landmark', 'Bot', 'Brain',
  'Zap', 'Globe', 'Database', 'Terminal', 'Code', 'Cpu', 'Rocket', 'Target',
  'DollarSign', 'Briefcase', 'LineChart', 'PieChart', 'ShieldCheck', 'ShieldAlert',
  'Megaphone', 'FileText', 'Lightbulb', 'Cloud', 'Compass', 'Feather',
])

async function executeManageAction(
  action: string,
  attrs: Record<string, string>
): Promise<ManageResult> {
  try {
    const userId = await getOperatorUserId()
    if (!userId) {
      return { ok: false, message: 'No operator user found.' }
    }

    switch (action) {
      /* ----------------------------- create_agent ----------------------------- */
      case 'create_agent': {
        const name = (attrs.name ?? '').toString().trim().slice(0, 80)
        if (!name) return { ok: false, message: 'create_agent requires "name".' }
        if (BUILTIN_IDS.has(name.toLowerCase())) {
          return {
            ok: false,
            message: `Cannot create a custom agent with the reserved name "${name}". Use edit_agent to modify the built-in.`,
          }
        }
        const role = (attrs.role ?? 'Specialist').toString().trim().slice(0, 200) || 'Specialist'
        const specialty = (attrs.specialty ?? '').toString().trim().slice(0, 500)
        const color = validateHexColor(attrs.color) ?? '#00f0ff'
        const icon = VALID_ICONS_SET.has(attrs.icon ?? '') ? attrs.icon! : 'Sparkles'
        const toolsArr = (attrs.allowed_tools ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter((s) => VALID_TOOLS_SET.has(s))
        if (toolsArr.length === 0) {
          return {
            ok: false,
            message: 'create_agent requires at least one valid tool in allowed_tools.',
          }
        }
        const systemPrompt = (attrs.system_prompt ?? '').toString()
        if (systemPrompt.length < 20) {
          return {
            ok: false,
            message: 'create_agent requires a system_prompt of at least 20 characters.',
          }
        }
        const created = await db.customSubagent.create({
          data: {
            userId,
            name,
            role,
            specialty,
            color,
            icon,
            allowedTools: JSON.stringify(toolsArr),
            systemPrompt: systemPrompt.slice(0, 8000),
            enabled: true,
            isBuiltinOverlay: false,
          },
        })
        return {
          ok: true,
          message: `Custom sub-agent "${name}" created with id "${created.id}". It can now be dispatched via <dispatch agent="${created.id}" ... />.`,
          data: { id: created.id, name },
        }
      }

      /* ------------------------------ edit_agent ------------------------------ */
      case 'edit_agent': {
        const id = (attrs.id ?? '').toString().trim().toLowerCase()
        if (!id) return { ok: false, message: 'edit_agent requires "id".' }
        const isBuiltin = BUILTIN_IDS.has(id)
        const update: any = {}
        if (attrs.name) update.name = attrs.name.trim().slice(0, 80)
        if (attrs.role) update.role = attrs.role.trim().slice(0, 200)
        if (attrs.specialty) update.specialty = attrs.specialty.trim().slice(0, 500)
        if (attrs.color) {
          const c = validateHexColor(attrs.color)
          if (c) update.color = c
        }
        if (attrs.icon && VALID_ICONS_SET.has(attrs.icon)) update.icon = attrs.icon
        if (attrs.allowed_tools) {
          const tools = attrs.allowed_tools
            .split(',')
            .map((s) => s.trim())
            .filter((s) => VALID_TOOLS_SET.has(s))
          if (tools.length > 0) update.allowedTools = JSON.stringify(tools)
        }
        if (attrs.system_prompt) {
          if (attrs.system_prompt.length < 20) {
            return { ok: false, message: 'system_prompt must be at least 20 characters.' }
          }
          update.systemPrompt = attrs.system_prompt.slice(0, 8000)
        }
        if (attrs.enabled !== undefined) {
          update.enabled = attrs.enabled === 'true'
        }
        if (Object.keys(update).length === 0) {
          return { ok: false, message: 'edit_agent: no editable fields provided.' }
        }

        if (isBuiltin) {
          // Upsert overlay
          const existing = await db.customSubagent.findFirst({
            where: { userId, id, isBuiltinOverlay: true },
          })
          if (existing) {
            await db.customSubagent.update({ where: { id: existing.id }, data: update })
            return {
              ok: true,
              message: `Built-in agent "${id}" overlay updated. Fields changed: ${Object.keys(update).join(', ')}.`,
            }
          } else {
            const builtin = SUBAGENTS.find((s) => s.id === id)!
            await db.customSubagent.create({
              data: {
                id: builtin.id,
                userId,
                name: update.name ?? builtin.name,
                role: update.role ?? builtin.role,
                specialty: update.specialty ?? builtin.specialty,
                color: update.color ?? builtin.color,
                icon: update.icon ?? builtin.icon,
                allowedTools: update.allowedTools ?? JSON.stringify(builtin.allowedTools),
                systemPrompt: update.systemPrompt ?? builtin.systemPrompt,
                enabled: update.enabled ?? true,
                isBuiltinOverlay: true,
              },
            })
            return {
              ok: true,
              message: `Built-in agent "${id}" overlay created. Fields changed: ${Object.keys(update).join(', ')}.`,
            }
          }
        } else {
          // Custom — update in place
          const existing = await db.customSubagent.findFirst({
            where: { userId, id, isBuiltinOverlay: false },
          })
          if (!existing) {
            return { ok: false, message: `Custom sub-agent "${id}" not found.` }
          }
          await db.customSubagent.update({ where: { id: existing.id }, data: update })
          return {
            ok: true,
            message: `Custom sub-agent "${id}" updated. Fields changed: ${Object.keys(update).join(', ')}.`,
          }
        }
      }

      /* ----------------------------- delete_agent ----------------------------- */
      case 'delete_agent': {
        const id = (attrs.id ?? '').toString().trim().toLowerCase()
        if (!id) return { ok: false, message: 'delete_agent requires "id".' }
        if (BUILTIN_IDS.has(id)) {
          // For built-in: delete the overlay if any (effectively "reset to default").
          const overlay = await db.customSubagent.findFirst({
            where: { userId, id, isBuiltinOverlay: true },
          })
          if (overlay) {
            await db.customSubagent.delete({ where: { id: overlay.id } })
            return {
              ok: true,
              message: `Built-in agent "${id}" overlay deleted (reset to defaults). Built-ins cannot be fully deleted.`,
            }
          }
          return {
            ok: false,
            message: `Cannot delete built-in agent "${id}". Use toggle_agent with enabled="false" to disable it, or edit_agent to change its prompt.`,
          }
        }
        const existing = await db.customSubagent.findFirst({
          where: { userId, id, isBuiltinOverlay: false },
        })
        if (!existing) {
          return { ok: false, message: `Custom sub-agent "${id}" not found.` }
        }
        await db.customSubagent.delete({ where: { id: existing.id } })
        return {
          ok: true,
          message: `Custom sub-agent "${existing.name}" (${id}) deleted.`,
        }
      }

      /* ----------------------------- toggle_agent ----------------------------- */
      case 'toggle_agent': {
        const id = (attrs.id ?? '').toString().trim().toLowerCase()
        if (!id) return { ok: false, message: 'toggle_agent requires "id".' }
        const enabledStr = (attrs.enabled ?? '').toString().toLowerCase()
        if (enabledStr !== 'true' && enabledStr !== 'false') {
          return { ok: false, message: 'toggle_agent requires enabled="true" or "false".' }
        }
        const enabled = enabledStr === 'true'
        const isBuiltin = BUILTIN_IDS.has(id)
        if (isBuiltin) {
          // Upsert overlay with the enabled flag
          const existing = await db.customSubagent.findFirst({
            where: { userId, id, isBuiltinOverlay: true },
          })
          if (existing) {
            await db.customSubagent.update({
              where: { id: existing.id },
              data: { enabled },
            })
          } else {
            const builtin = SUBAGENTS.find((s) => s.id === id)!
            await db.customSubagent.create({
              data: {
                id: builtin.id,
                userId,
                name: builtin.name,
                role: builtin.role,
                specialty: builtin.specialty,
                color: builtin.color,
                icon: builtin.icon,
                allowedTools: JSON.stringify(builtin.allowedTools),
                systemPrompt: builtin.systemPrompt,
                enabled,
                isBuiltinOverlay: true,
              },
            })
          }
          return {
            ok: true,
            message: `Built-in agent "${id}" ${enabled ? 'ENABLED' : 'DISABLED'}.`,
          }
        } else {
          const existing = await db.customSubagent.findFirst({
            where: { userId, id, isBuiltinOverlay: false },
          })
          if (!existing) {
            return { ok: false, message: `Custom sub-agent "${id}" not found.` }
          }
          await db.customSubagent.update({
            where: { id: existing.id },
            data: { enabled },
          })
          return {
            ok: true,
            message: `Custom sub-agent "${existing.name}" (${id}) ${enabled ? 'ENABLED' : 'DISABLED'}.`,
          }
        }
      }

      /* --------------------------- set_income_goal ---------------------------- */
      case 'set_income_goal': {
        const amount = parseFloat(attrs.amount ?? '')
        if (!isFinite(amount) || amount < 0) {
          return { ok: false, message: 'set_income_goal requires a numeric "amount" >= 0.' }
        }
        const current = await getIncomeSettings()
        await setIncomeSettings({ ...current, monthlyGoal: amount })
        return {
          ok: true,
          message: `Monthly income goal updated to $${amount.toFixed(2)}.`,
        }
      }

      /* -------------------------- set_growth_target --------------------------- */
      case 'set_growth_target': {
        const percent = parseFloat(attrs.percent ?? '')
        if (!isFinite(percent)) {
          return { ok: false, message: 'set_growth_target requires a numeric "percent".' }
        }
        const current = await getIncomeSettings()
        await setIncomeSettings({ ...current, dailyGrowthTarget: percent })
        return {
          ok: true,
          message: `Daily growth target updated to ${percent}%.`,
        }
      }

      /* ------------------------------ log_income ------------------------------ */
      case 'log_income': {
        const amount = parseFloat(attrs.amount ?? '')
        if (!isFinite(amount) || amount <= 0) {
          return { ok: false, message: 'log_income requires a positive numeric "amount".' }
        }
        const source = (attrs.source ?? 'Manual').toString().trim().slice(0, 80) || 'Manual'
        const notes = (attrs.notes ?? '').toString().slice(0, 500)
        const created = await db.incomeEntry.create({
          data: { amount, source, notes, date: new Date() },
        })
        return {
          ok: true,
          message: `Logged $${amount.toFixed(2)} income from "${source}" (id: ${created.id}).`,
        }
      }

      /* ---------------------------- create_schedule --------------------------- */
      case 'create_schedule': {
        const name = (attrs.name ?? 'Mission').toString().trim().slice(0, 120) || 'Mission'
        const prompt = (attrs.prompt ?? '').toString().slice(0, 4000)
        if (!prompt) {
          return { ok: false, message: 'create_schedule requires a "prompt".' }
        }
        const intervalMin = parseInt(attrs.interval_min ?? '1440')
        const safeInterval =
          isFinite(intervalMin) && intervalMin > 0
            ? Math.min(intervalMin, 60 * 24 * 30)
            : 1440
        const now = new Date()
        const nextRunAt = new Date(now.getTime() + safeInterval * 60 * 1000)
        const created = await db.schedule.create({
          data: {
            userId,
            name,
            prompt,
            intervalMin: safeInterval,
            enabled: true,
            nextRunAt,
          },
        })
        return {
          ok: true,
          message: `Schedule "${name}" created (interval: ${safeInterval} min, id: ${created.id}).`,
        }
      }

      /* ---------------------------- delete_schedule --------------------------- */
      case 'delete_schedule': {
        const id = (attrs.id ?? '').toString().trim()
        if (!id) return { ok: false, message: 'delete_schedule requires "id".' }
        const existing = await db.schedule.findFirst({ where: { id, userId } })
        if (!existing) {
          return { ok: false, message: `Schedule "${id}" not found.` }
        }
        await db.schedule.delete({ where: { id } })
        return {
          ok: true,
          message: `Schedule "${existing.name}" (${id}) deleted.`,
        }
      }

      /* ---------------------------- update_settings --------------------------- */
      case 'update_settings': {
        // Accepts arbitrary key=value attrs and persists them as income/notif settings.
        // We map known keys to the proper setting type.
        const current = await getIncomeSettings()
        let changed: string[] = []
        const incomeUpdates: any = {}
        if (attrs.monthly_goal !== undefined) {
          const v = parseFloat(attrs.monthly_goal)
          if (isFinite(v) && v >= 0) {
            incomeUpdates.monthlyGoal = v
            changed.push('monthly_goal')
          }
        }
        if (attrs.daily_growth_target !== undefined) {
          const v = parseFloat(attrs.daily_growth_target)
          if (isFinite(v)) {
            incomeUpdates.dailyGrowthTarget = v
            changed.push('daily_growth_target')
          }
        }
        if (attrs.currency_symbol !== undefined) {
          incomeUpdates.currencySymbol = attrs.currency_symbol.slice(0, 4)
          changed.push('currency_symbol')
        }
        if (attrs.display_mode !== undefined) {
          if (attrs.display_mode === 'compact' || attrs.display_mode === 'detailed') {
            incomeUpdates.displayMode = attrs.display_mode
            changed.push('display_mode')
          }
        }
        if (Object.keys(incomeUpdates).length > 0) {
          await setIncomeSettings({ ...current, ...incomeUpdates })
        }
        if (changed.length === 0) {
          return {
            ok: false,
            message:
              'update_settings: no recognized keys. Supported: monthly_goal, daily_growth_target, currency_symbol, display_mode.',
          }
        }
        return {
          ok: true,
          message: `Settings updated: ${changed.join(', ')}.`,
        }
      }

      default:
        return {
          ok: false,
          message: `Unknown manage action: "${action}". Supported: create_agent, edit_agent, delete_agent, toggle_agent, set_income_goal, set_growth_target, log_income, create_schedule, delete_schedule, update_settings.`,
        }
    }
  } catch (e: any) {
    console.error('[orchestrator] executeManageAction failed:', e)
    return {
      ok: false,
      message: `Manage action "${action}" threw: ${e?.message ?? String(e)}`,
    }
  }
}

function validateHexColor(c?: string): string | null {
  if (!c || typeof c !== 'string') return null
  const trimmed = c.trim()
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmed)) return trimmed
  return null
}
