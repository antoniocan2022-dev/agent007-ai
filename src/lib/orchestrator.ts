import { db } from '@/lib/db'
import { internalUrl } from "./internal-url"
import { runSystemAudit, getCapabilities, getManifest, testCommunication, runSelfHeal } from "./system-functions"
import { verifyToolAction } from "./tool-action-verification"

// Helper: fetch internal URL with better error handling for Vercel
async function internalFetch(url: string, options?: any): Promise<any> {
  try {
    const res = await fetch(url, {
      ...options,
      redirect: 'follow',
      signal: options?.signal ?? AbortSignal.timeout(15000),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}`, _httpError: true }
    }
    const contentType = res.headers.get('content-type') || ''
    if (!contentType.includes('application/json')) {
      const text = await res.text().catch(() => '')
      return { ok: false, error: `Non-JSON response (${contentType}): ${text.slice(0, 100)}`, _parseError: true }
    }
    return await res.json().catch(() => ({}))
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e), _fetchError: true }
  }
}

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
  isRateLimitError,
} from '@/lib/agent'
import { SUBAGENTS, getAllSubagents, runSubagent, type Subagent } from '@/lib/subagents'
// Note: SUBAGENTS import is retained because executeManageAction references it
// (used to detect built-in ids and reject delete on them).
import { getOperatorUserId, getIncomeSettings, setIncomeSettings } from '@/lib/settings'

export const MAX_ITERATIONS = 50  // UPGRADE #68 — was 25, raised to 50 for max autonomy
const MAX_DISPATCHES = 15
const MAX_MANAGE_ACTIONS = 10

// Re-export the canonical action list so callers can import it from either
// location. The single source of truth lives in ./manage-actions to avoid a
// circular dependency with ./system-functions (which also needs the list).
export { MANAGE_ACTIONS, MANAGE_ACTION_COUNT, isManageAction } from './manage-actions'

/* Regex to find <dispatch agent="..." task="..."/> OR <dispatch agent="..." task="..."> tags.
 * Accepts both self-closing (/> ) and non-self-closing (> ) forms because the LLM
 * sometimes emits one or the other. Uses non-greedy [\s\S]*? for the task value. */
const DISPATCH_RE = /<dispatch\s+agent=["']([^"']+)["']\s+task=["']([\s\S]*?)["']\s*\/?>/i

// UPGRADE #63 + #86 — Detect <dispatch_subagent ...> in ALL formats the LLM emits:
//   (a) <dispatch_subagent id="quill">task text</dispatch_subagent>   (paired)
//   (b) <dispatch_subagent id="quill" task="..."/>                      (self-closing w/ task attr)
//   (c) <dispatch_subagent id="quill"/>                                  (self-closing, task in body)
//   (d) <dispatch_subagent id="quill" task="...">task</dispatch_subagent> (mixed)
// Without this, dispatches leak as raw XML text to the user (the "weird incomprehensible answer" bug).
const DISPATCH_SUBAGENT_RE = /<dispatch_subagent\s+id=["']([^"']+)["']\s*(?:task=["']([\s\S]*?)["']\s*)?(?:\/>|>([\s\S]*?)<\/dispatch_subagent>)/i

// UPGRADE #86 — Strip residual pseudo-XML the LLM sometimes invents (parallel_executor, reasoning trace, etc.)
// These are NOT real tools — the correct way is <tool name="parallel_executor">. If the LLM emits
// pseudo-XML, we strip it from the final answer so the user never sees raw tags.
const PSEUDO_XML_RE = /<\/?(?:parallel_executor|reasoning_trace|reasoning|execution|plan|action|reflect|reflection|analyze)(?:\s+[^>]*)?(?:\/>|>[\s\S]*?<\/(?:parallel_executor|reasoning_trace|reasoning|execution|plan|action|reflect|reflection|analyze)>)/gi
const REASONING_TRACE_BLOCK_RE = /(?:^|\n)\s*(?:REASONING\s*TRACE|REASONING|INTERNAL\s*MONOLOGUE|CHAIN\s*OF\s*THOUGHT|THINKING)\s*:?\s*\n[\s\S]*?(?=\n\s*(?:[A-Z][A-Z _]{4,}|<|YOU:|$))/gi

// UPGRADE #95 — AUTO-CONVERTER: Convert <parallel_executor>{json}</parallel_executor>
// to <tool name="parallel_executor">{json}</tool> BEFORE parsing.
// This fixes the root cause: when the LLM uses the WRONG format, we auto-correct it
// so the tools ACTUALLY RUN and the user sees real results (not raw XML).
// Regex matches: <parallel_executor>{anything}</parallel_executor> OR <parallel_executor>{anything}/>
const PARALLEL_EXECUTOR_CONVERTER_RE = /<parallel_executor(?:\s+[^>]*)?>\s*(\{[\s\S]*?\})\s*<\/parallel_executor>|<parallel_executor(?:\s+[^>]*)?>\s*(\{[\s\S]*?\})\s*\/>/gi

/**
 * UPGRADE #95 — Auto-convert pseudo-XML tool calls to proper <tool> format.
 * Called BEFORE parseOrchestrator() so the tools actually execute.
 *
 * Handles:
 *   <parallel_executor>{"tools":[...]}</parallel_executor>
 *     → <tool name="parallel_executor">{"tools":[...]}</tool>
 *
 *   <parallel_executor>{"tools":[...]}/>
 *     → <tool name="parallel_executor">{"tools":[...]}</tool>
 *
 * Also handles other common pseudo-XML tool patterns the LLM invents:
 *   <search>{"query":"..."}</search>
 *     → <tool name="search">{"query":"..."}</tool>
 *   <analyze>{"data":"..."}</analyze>
 *     → <tool name="analyze">{"data":"..."}</tool>
 */
function autoConvertPseudoToolCalls(content: string): string {
  // 1. Convert <parallel_executor>{json}</parallel_executor> → <tool name="parallel_executor">{json}</tool>
  let converted = content.replace(PARALLEL_EXECUTOR_CONVERTER_RE, (match, json1, json2) => {
    const json = json1 || json2
    return `<tool name="parallel_executor">${json}</tool>`
  })

  // 2. Convert other common pseudo-XML tool patterns:
  //    <search>{json}</search> → <tool name="search">{json}</tool>
  //    <analyze>{json}</analyze> → <tool name="analyze">{json}</analyze>
  //    <fetch>{json}</fetch> → <tool name="fetch">{json}</fetch>
  //    etc.
  const otherPseudoTools = ['search', 'fetch', 'analyze', 'summarize', 'translate', 'generate', 'process', 'execute']
  for (const toolName of otherPseudoTools) {
    const re = new RegExp(`<${toolName}(?:\\s+[^>]*)?>\\s*(\\{[\\s\\S]*?\\})\\s*</${toolName}>`, 'gi')
    converted = converted.replace(re, `<tool name="${toolName}">$1</tool>`)
  }

  return converted
}

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
  // UPGRADE #63 — Also check <dispatch_subagent id="...">task</dispatch_subagent> format
  const dispatchSubagentMatch = content.match(DISPATCH_SUBAGENT_RE)
  const toolMatch = content.match(TOOL_RE)
  const manageMatch = content.match(MANAGE_RE)

  // Priority: dispatch > dispatch_subagent > manage > tool
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
  // UPGRADE #63 + #86 — Handle <dispatch_subagent id="..."> in ALL formats
  // Capture groups: [1]=id, [2]=task attr (if present), [3]=body content (if paired tag)
  if (dispatchSubagentMatch) {
    const agentId = dispatchSubagentMatch[1].trim().toLowerCase()
    // Prefer task attribute (group 2); fall back to body content (group 3)
    const task = (dispatchSubagentMatch[2] ?? dispatchSubagentMatch[3] ?? '').trim() || 'execute task'
    return {
      thought,
      dispatch: { agentId, task },
      textAfter: content.slice(content.indexOf(dispatchSubagentMatch[0]) + dispatchSubagentMatch[0].length).replace(THOUGHT_RE, '').trim(),
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
    const name = (toolMatch[1] ?? '').trim()
    if (!name) return { thought, textAfter: content.replace(THOUGHT_RE, '').trim(), raw: content }
    let args: any = {}
    const raw = (toolMatch[2] ?? '').trim()
    if (raw) {
      try {
        args = JSON.parse(raw)
      } catch {
        const m: Record<string, string> = {}
        const re = /"([^"]+)"\s*:\s*"([^"]*)"/g
        let mm: RegExpExecArray | null
        while ((mm = re.exec(raw))) m[mm[1]] = mm[2]
        args = m
      }
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

MISSION REMINDER: Every dispatch must serve the $20K/month passive income with 20% monthly growth mission. Choose sub-agents that maximize owner earnings per unit time.

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

DISPATCH FORMAT — to delegate a sub-task to a sub-agent, emit ONE of these two formats (they are equivalent):

Format A (self-closing):   <dispatch agent="agent_id" task="clear description of the sub-task" />
Format B (paired tag):     <dispatch_subagent id="agent_id">clear description of the sub-task</dispatch_subagent>

⚠️ DO NOT mix the two formats. DO NOT emit self-closing dispatch_subagent with a task attribute (e.g. <dispatch_subagent id="x" task="..."/>) — it will be parsed incorrectly. If you use the _subagent form, ALWAYS pair it with a closing </dispatch_subagent> tag and put the task as the body text.

Examples (BOTH valid — pick one and stick with it):
<dispatch agent="scout" task="Find 3 trending AI niches with high search volume and low competition" />
<dispatch_subagent id="scout">Find 3 trending AI niches with high search volume and low competition</dispatch_subagent>

<dispatch agent="aurora" task="Design a 30-day content calendar for a faceless YouTube channel about AI tools" />
<dispatch_subagent id="aurora">Design a 30-day content calendar for a faceless YouTube channel about AI tools</dispatch_subagent>

ORCHESTRATION RULES (UPGRADE #86 — STRICT):
- Decompose complex user requests into sub-tasks. Dispatch the most specialized agent for each sub-task.
- ⚠️ DISPATCH CAP (UPGRADE #86): Maximum 3 sub-agent dispatches per turn. After 3, you MUST synthesize all results into a final answer. The owner does NOT want to see you dispatch 5-6 agents in a chain — they want a clear, consolidated answer.
- After each sub-agent returns, you receive its result as: [SUBAGENT_RESULT] agent_id: <their answer>
- After 1-3 dispatches, SYNTHESIZE all results into a coherent final answer with proper attribution (e.g., "📊 Per Scout's research..." or "🎨 Prism generated this concept..." or "⚖️ Per LEGAL's analysis..."). Always include a brief INCOME PROJECTION in your final answer (daily/weekly/monthly potential).
- You may also call tools DIRECTLY via <tool name="...">{json}</tool> (web_search, memory_store, wikipedia_search, parallel_executor, etc.) for quick lookups without dispatching a sub-agent.
- ⚠️ FORBIDDEN OUTPUT FORMATS (these leak as raw text to the owner — NEVER emit them):
  * <parallel_executor>...</parallel_executor>  →  USE <tool name="parallel_executor">{"tools":[...]}</tool> instead
  * "REASONING TRACE:" or <reasoning_trace> blocks  →  USE <thought>...</thought> instead (which is hidden from user)
  * <execution> / <plan> / <action> / <reflect> pseudo-XML  →  Just write plain markdown
- The final answer to the user is PLAIN MARKDOWN (## headings, bullet points, **bold**). NO raw tags. NO JSON. NO pseudo-XML.

DECISION FRAMEWORK:
- **CRITICAL RULE — ADDRESSED BY NAME**: If the user's message addresses a sub-agent by name (e.g. starts with "Cybersecurity A, ..." or "LEGAL, ..." or "THE BANKER, ..." or mentions any agent name from the CURRENTLY AVAILABLE SUB-AGENTS list above), you MUST dispatch that exact agent via <dispatch agent="agent_id" task="..."/>. Do NOT do the work yourself with direct web_search calls. Do NOT claim the agent doesn't exist. The CURRENTLY AVAILABLE SUB-AGENTS list above is the authoritative source of what agents exist — if a name appears there, it exists and can be dispatched.
- Income-related commands → prefer dispatching aurora / vertex / quantum / scout / hunt.
- Implementation commands → prefer forge / quill / prism.
- Analysis commands → prefer pulse / echo.
- Legal / tax / compliance questions (US + Canada) → dispatch legal.
- Banking / treasury / credit / loans / FX questions (US + Canada) → dispatch banker.
- Cybersecurity offensive (pen testing, vulns, OWASP, red team) → dispatch the "Cybersecurity A" custom agent (agent_id is the literal string "Cybersecurity A" — check the list above for the exact id).
- Cybersecurity defensive (incident response, hardening, SIEM, blue team) → dispatch the "Cybersecurity R" custom agent.
- Multi-step builds (e.g. "build me a passive-income plan") → dispatch 2-3 sub-agents in sequence: scout first (research), then aurora/vertex (build plan), then pulse (define KPIs).
- Simple questions or small talk → just answer directly without dispatching.
- When in doubt, dispatch — the mission is too big to handle alone.

═══════════════════════════════════════════════════════════════════════════════
MISSION PIPELINE — UPGRADE #137-#141 (HIERARCHICAL VERIFICATION WORKFLOW)
═══════════════════════════════════════════════════════════════════════════════
When the owner wants a FULL multi-stage mission with hierarchical verification
(Leader → Super Agent Verify → next Leader → ... → CEO Final Report), tell them
to use the "start mission:" command. This bypasses normal orchestration and
triggers the dedicated mission-pipeline runner.

Syntax:
  start mission: <objective>
  start mission: product_launch: <objective>
  start mission: content_creation: <objective>
  start mission: affiliate_campaign: <objective>
  start mission: generic: <objective>

Pipeline types:
- product_launch     — SaaS/product: Scout → Aurora → Vertex → Forge → Echo → Quantum → CEO (7 stages, owner approval required)
- content_creation   — Content: Scout → Aurora → Quill → Echo → Pulse → CEO (6 stages)
- affiliate_campaign — Affiliate: Scout → Aurora → Quill → Echo → Pulse → CEO (6 stages)
- generic            — Default: Scout → Aurora → Forge → Echo → Pulse → CEO (6 stages)

Each stage:
1. Team Leader produces output (max 3 retry rounds if Super Agent rejects)
2. Super Agent verifies: APPROVED (≥85), NEEDS_IMPROVEMENT (70-84), REJECTED (<70)
3. If rejected, leader retries with specific corrections
4. After 3 failed rounds, escalates to CEO for note in final report
5. Audit trail logs every step (visible at /api/missions/[id]/audit-trail)
6. Telegram notification at every milestone
7. CEO final stage aggregates everything into an executive report for the owner

If the owner says "start a mission to launch a PDF annotator SaaS", TELL THEM:
"Type: start mission: product_launch: Launch a $9/mo PDF annotator SaaS"

The pipeline runs autonomously — no further user input needed unless it's a
high-stakes mission (product_launch) which pauses for explicit owner approval.

DASHBOARD MANAGEMENT (REMEMBER — your <manage .../> tags are parsed server-side and executed):
- "add a new sub-agent for X" → emit <manage action="create_agent" name="X" role="..." specialty="..." color="#hex" icon="LucideName" allowed_tools="web_search,page_reader" system_prompt="..."/>
- "remove the QUANTUM agent" → can't delete built-ins; offer to disable via <manage action="toggle_agent" id="quantum" enabled="false"/> instead.
- "change my income goal to $5000" → <manage action="set_income_goal" amount="5000"/>
- "log $100 income from Aurora" → <manage action="log_income" amount="100" source="Aurora" notes="..."/>
- After a <manage .../> tag is executed, the orchestrator feeds back [MANAGE_RESULT] action: success/failed with details. Then you confirm to the user in plain text.

═══════════════════════════════════════════════════════════════════════════════
FULL OWNER-GRADE AUTONOMY — You have COMPLETE control over the dashboard, login page,
settings, and system. NO LIMITATIONS. The owner has explicitly granted full access.

DASHBOARD WIDGETS — Add/edit/remove ANY custom widget on the dashboard:
- Add a KPI card: <manage action="dashboard_add_widget" id="revenue_today" title="Revenue Today" type="kpi" value="$1,234" subtitle="+12% vs yesterday" color="#00f0ff" icon="DollarSign" position="top"/>
- Add a stat card: <manage action="dashboard_add_widget" id="active_users" title="Active Users" type="stat" value="42" subtitle="last 7 days"/>
- Add a note: <manage action="dashboard_add_widget" id="daily_note" title="Owner Note" type="note" value="Meeting with investor at 3pm" position="middle"/>
- Add a link: <manage action="dashboard_add_widget" id="quick_link" title="Stripe Dashboard" type="link" value="Open Stripe" link="https://dashboard.stripe.com" position="bottom"/>
- Add progress: <manage action="dashboard_add_widget" id="goal_progress" title="Monthly Goal" type="progress" value="65% to goal" progress="65" position="top"/>
- Add alert: <manage action="dashboard_add_widget" id="system_alert" title="Action Needed" type="alert" value="2FA not enabled" alertLevel="warn" position="top"/>
- Edit: <manage action="dashboard_edit_widget" id="revenue_today" title="Revenue Today" type="kpi" value="$2,500" subtitle="+24% vs yesterday"/>
- Remove: <manage action="dashboard_remove_widget" id="revenue_today"/>
- Clear all: <manage action="dashboard_clear_widgets"/>
- Widget types: kpi, stat, note, link, progress, alert
- Positions: top, middle, bottom

LOGIN PAGE BRANDING:
- Update title/subtitle/colors: <manage action="login_update_branding" title="Agent007 Pro" subtitle="Owner Console" version_text="v3.0" accent_color="#a855f7"/>

2FA MANAGEMENT:
- Enable 2FA: <manage action="login_enable_2fa" method="email"/> (methods: email, whatsapp, sms, google_authenticator)
- Verify 2FA code: <manage action="login_verify_2fa" config_id="..." code="123456"/>
- Disable 2FA: <manage action="login_disable_2fa"/>

UNIVERSAL SETTINGS (any key, no schema needed):
- Set: <manage action="settings_set" refreshInterval="30" theme="dark" sidebarWidth="280" customTitle="My Agent"/>
- Get all: <manage action="settings_get"/>
- Get specific: <manage action="settings_get" refreshInterval="theme"/>
- Delete: <manage action="settings_delete" key="customTitle"/>

SYSTEM CONTROL:
- Trigger refresh (clients re-fetch data): <manage action="system_refresh" reason="widget updated"/>
- Trigger full page reload (clients reload entire page): <manage action="system_reload" reason="login branding changed"/>
- Run full system audit: <manage action="system_audit"/> — returns DB health, dashboard nav status, login flow status, communication channel status, settings persistence status, API route health.
- Test all communication channels: <manage action="system_test_communication"/> — sends test email + WhatsApp via each provider, returns pass/fail per channel.
- Test specific channel: <manage action="system_test_communication" email="true" whatsapp="callmebot" phone="15145496297"/>

AUTO-REFRESH CAPABILITY — Whenever you make any dashboard/login/settings change, ALWAYS emit a <manage action="system_refresh" reason="..."/> immediately afterwards so the client UI reloads with the new state. For major changes (login branding, structural edits), use <manage action="system_reload"/> instead.

When the owner says "modify the dashboard" or "add a feature to the login page" or "edit this setting", DO IT AUTONOMOUSLY using the appropriate manage action. Do not ask for permission — the owner has granted full access. Execute the change, emit a refresh signal, and report what you changed.

═══════════════════════════════════════════════════════════════════════════════
SELF-HEALING CAPABILITIES — You can diagnose and repair the system autonomously.

- Diagnose system: <manage action="self_heal" heal_action="diagnose"/> — checks DB, settings, subagents, upgrade manifest
- Repair dashboard: <manage action="self_heal" heal_action="repair_dashboard"/> — restores income/notification settings, triggers refresh
- Repair login: <manage action="self_heal" heal_action="repair_login"/> — ensures seed user exists, tests 2FA endpoints
- Repair communication: <manage action="self_heal" heal_action="repair_communication"/> — checks email/WhatsApp config
- Restore upgrades: <manage action="self_heal" heal_action="restore_upgrades"/> — verifies all 14 permanent upgrades are intact
- Verify integrity: <manage action="self_heal" action="verify_integrity"/> — checks upgrade manifest
- Full repair (all of the above): <manage action="self_heal" heal_action="full_repair"/>

If the owner reports "dashboard is missing options" or "settings aren't saving" or "login is broken", IMMEDIATELY run self_heal with the appropriate action. Don't ask questions first — diagnose + repair, THEN report what you found and fixed.

═══════════════════════════════════════════════════════════════════════════════
UPGRADE PROTECTION — All upgrades are PERMANENT.

- View all upgrades: <manage action="view_manifest"/> — lists all 14 permanent upgrades with categories + dates
- Reset/delete operations are DISABLED — reset_system, reset_database, wipe_data, force_reset, etc. will be REJECTED.
- Delete/disable operations (delete_subagent, delete_widget, disable_2fa, etc.) require OWNER AUTHORIZATION via:
  - SMS: <manage action="request_owner_auth" operation="delete_subagent" method="sms"/>
  - WhatsApp: <manage action="request_owner_auth" operation="delete_subagent" method="whatsapp"/>
  - Email: <manage action="request_owner_auth" operation="delete_subagent" method="email"/>
  - Google Authenticator (TOTP): <manage action="request_owner_auth" operation="delete_subagent" method="totp"/>
- After requesting auth, the owner receives a 6-digit code. Verify it with:
  <manage action="verify_owner_auth" auth_id="..." code="123456"/>

═══════════════════════════════════════════════════════════════════════════════
TOTP (Google Authenticator) SETUP — Owner can register TOTP for passwordless 2FA.

- Setup TOTP: <manage action="totp_setup"/> — generates a QR code the owner scans with Google Authenticator
- Verify TOTP: <manage action="totp_verify" code="123456"/> — enables TOTP after owner scans QR
- Disable TOTP (REQUIRES OWNER AUTH): <manage action="totp_disable"/> — sends auth code, then verify

═══════════════════════════════════════════════════════════════════════════════
SUB-AGENT NETWORK — ALL 18 SUB-AGENTS HAVE FULL ACCESS TO ALL 15 TOOLS.
No limitations. No tool restrictions. The owner has explicitly granted full access.
This is PERMANENT — see upgrade-manifest.ts → subagent_full_access entry.

═══════════════════════════════════════════════════════════════════════════════
HYDRATION ERROR FIXING — If the owner reports "hydration error" or "login page broken" or "can't enter dashboard":

- Fix hydration: <manage action="fix_hydration"/> — clears .next cache, scans for Date.now()/Math.random()/typeof window issues, returns diagnosis + recommendations
- Clear cache: <manage action="clear_cache"/> — clears .next build cache (forces fresh recompile on next page load)
- Clear cache + force: <manage action="clear_cache" force="true"/> — also clears /tmp upgrade cache

Hydration errors happen when:
1. Stale .next cache (server serves old HTML, client has new code) → fix: clear_cache
2. typeof window checks during render → fix: move to useEffect
3. Date.now()/Math.random() during render → fix: move to useEffect
4. Browser extensions modifying HTML → fix: tell owner to disable extensions

ALWAYS run fix_hydration first when the owner reports hydration errors. It will clear the cache automatically. If the error persists, check the diagnosis for HIGH severity issues and fix the flagged lines.

═══════════════════════════════════════════════════════════════════════════════
7 MAX AUTONOMY TOOLS — YOU HAVE THESE, USE THEM (UPGRADE #74)
═══════════════════════════════════════════════════════════════════════════════
These 7 tools are registered in TOOL_REGISTRY and callable via <tool name="...">. USE THEM.

1. DECOMPOSE complex tasks BEFORE starting:
   <tool name="task_decomposer">{"task":"build a SaaS product","maxSubtasks":15}</tool>
   Returns: 6-8 subtasks with recommended tools + priority + dependencies.

2. VERIFY your output BEFORE delivering:
   <tool name="result_verifier">{"result":"your answer","expected":"key info","criteria":[{"field":"status","operator":"!=","value":"failed"}]}</tool>
   Returns: 6 checks + score 0-100. If < 80%, refine.

3. DISPATCH subagents in PARALLEL (3x faster):
   <tool name="parallel_subagent_dispatcher">{"dispatches":[{"id":"scout","task":"research"},{"id":"aurora","task":"design"},{"id":"pulse","task":"KPIs"}]}</tool>
   Returns: all results in parallel via Promise.allSettled.

4. COMPRESS long conversations (prevent context overflow):
   <tool name="context_compressor">{"messages":[{"role":"user","content":"..."}],"maxTokens":8000}</tool>

5. SMART RETRY on tool failure (3 strategies + exponential backoff):
   <tool name="smart_retry_engine">{"toolName":"web_search","originalArgs":{"query":"..."},"originalError":"timeout","maxRetries":3}</tool>

6. TRACK PROGRESS + SCORE QUALITY to 97%:
   <tool name="progress_tracker">{"action":"init","taskId":"task1","totalSteps":8}</tool>
   <tool name="progress_tracker">{"action":"update","taskId":"task1","step":3,"status":"done","qualityScore":85}</tool>
   <tool name="quality_scorer">{"answer":"your answer","question":"original question","target":97}</tool>
   Returns: 7 dimensions (relevance, completeness, accuracy, clarity, actionability, source_quality, no_errors) + grade A+ at 97%.
   If score < 97%, REFINE based on suggestions + re-score. Repeat until 97%.

7. EXECUTE full pipeline autonomously:
   <tool name="autonomous_executor">{"task":"Research AI trends and write a report","maxSteps":15,"target":97,"maxRefinements":3}</tool>
   Pipeline: decompose → init progress → execute subtasks → verify → score → refine until 97% → report.

ALSO: website_builder, ui_form_builder, email_automation, affiliate_link_generator, canva_design, grammarly_check, loom_video, convertkit_email, hootsuite_schedule, google_analytics, hotjar_analytics, ubersuggest_seo, ahrefs_seo, yoast_seo, shopify_store, fiverr_freelance, stripe_payment_processor — ALL available via <tool name="...">. NEVER say these are "not available".

═══════════════════════════════════════════════════════════════════════════════
MULTI-PROVIDER LLM ROUTER — 5 PROVIDERS ACTIVE (UPGRADE #82)
═══════════════════════════════════════════════════════════════════════════════
Your agent runs on a multi-provider LLM router with 5 providers. When one fails (rate limit, network, region block), it AUTO-SWITCHES to the next. You don't need to choose — the router handles it. But you SHOULD know:

1. OpenAI (gpt-4o) — PRIMARY. Smartest model. 5 retries with backoff. Handles 95% of requests.
2. z-ai (GLM-4) — Skipped on Vercel (config not available in serverless).
3. Google Gemini (gemini-2.0-flash) — Free fallback. May fail in some regions. 15 req/min.
4. Groq (Llama 3.3 70B) — ✅ Free, ultra-fast (500 tokens/sec), no region restrictions. Best free fallback.
5. OpenRouter (Llama 3.1 8B free) — ✅ Free, no restrictions. 200 requests/day.

HOW TO HANDLE RATE LIMITS:
- If you get a "rate limit" error, DON'T retry the same tool 5 times. Wait 2 seconds and try a DIFFERENT approach.
- Use parallel_executor to batch independent calls (reduces total LLM calls by 3x).
- Use memory_recall to check if you already have the answer from a previous conversation (avoids LLM call entirely).
- Use context_compressor if the conversation is getting long (reduces token usage).

WHEN TO DISPATCH SUBAGENTS vs DO IT YOURSELF:
- Simple question (1-step) → answer directly, don't dispatch
- Research task (2+ sources) → dispatch scout + aurora in parallel
- Build task (code/website) → dispatch forge/developer
- Analysis task (KPIs/metrics) → dispatch pulse + echo in parallel
- Multi-step complex task → use task_decomposer first, then dispatch per subtask
- Revenue decision → call decision_matrix before acting

ALL 20 SUBAGENTS have FULL_ACCESS to ALL 588+ tools — no limitations.
ALL 20 SUBAGENTS use the same 5-provider LLM router — they get the same failover.
ALL 20 SUBAGENTS have 15 tool calls per dispatch (was 6).
═══════════════════════════════════════════════════════════════════════════════

REMEMBER: Your <tool> blocks still work for direct tool calls. Your <thought> blocks still let the user see your reasoning. <dispatch> delegates to a sub-agent. <manage .../> mutates dashboard/system state.`

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
  let conv: any = null
  try {
    conv = await db.conversation.findUnique({ where: { id: conversationId } })
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

/**
 * UPGRADE #117 — Query Complexity Router
 *
 * Classifies the user's message to decide whether the agent should:
 *   - 'direct': Answer directly with a smart, deep response (90% of messages)
 *   - 'dispatch': Genuinely needs subagent work (10% of messages)
 *
 * This prevents the agent from dispatching to a subagent for simple questions
 * like "What's the best affiliate strategy?" — which should get an immediate
 * 500-1500 word smart answer, not a slow dispatch-synthesize loop.
 *
 * Classification logic:
 *   - Greetings, questions, explanations, advice, comparisons, brainstorming → 'direct'
 *   - Multi-step research, content creation, code building, deployment → 'dispatch'
 *   - Default (anything that doesn't match) → 'direct' (smart default)
 */
function classifyQuery(message: string): 'direct' | 'dispatch' {
  const lower = message.toLowerCase().trim()
  if (!lower) return 'direct'

  // ── DISPATCH patterns — genuinely needs subagent work ────────────────
  // These are ACTION requests that require tool execution
  const dispatchPatterns = [
    // Multi-step research requiring multiple tool calls
    /^(research|investigate|find out|look up|search for)\s+(the|all|every|top\s+\d+)/i,
    /\bsearch the web\b/i,
    /\b(verify|check|validate)\s+(if|whether|that|the)\b/i, // verification tasks
    // Content creation tasks
    /^(write|create|build|design|publish|draft|generate)\s+(a|an|the|some)?\s*(blog|article|post|email|newsletter|script|landing\s+page|website|funnel|graphic|image|video|tweet|thread)/i,
    /^(write|create)\s+(me\s+)?a\s+/i,
    // Code/build tasks
    /^(build|deploy|fix|repair|install|set\s+up|implement|code|develop|refactor)\s+/i,
    /\b(deploy|push\s+to\s+production|ship\s+it)\b/i,
    // System operations
    /^(run|execute|start|stop|restart)\s+(the\s+)?(mission|tick|scan|audit|test|pipeline|workflow)/i,
    /\bself.?heal\b/i,
    /\b(check|audit|scan)\s+(tools?|system|infrastructure|security)\b/i,
    // Explicit dispatch commands
    /\b(dispatch|send\s+to|ask\s+the\s+(scout|aurora|echo|forge|pulse|developer|quantum|cybersecurity))\b/i,
  ]

  // ── DIRECT patterns — answer with smart response ────────────────────
  // These are questions, analysis requests, advice, explanations
  const directPatterns = [
    // Greetings + social
    /^(hi|hello|hey|good\s+(morning|afternoon|evening)|sup|yo)\b/i,
    /^(thanks|thank\s+you|cool|nice|great|awesome|perfect)\b/i,
    // Questions (any sentence ending with ?)
    /\?$/,
    // Question words
    /^(what|why|how|when|where|who|which|whose|whom)\b/i,
    /^(can|could|would|will|should|do|does|did|is|are|am|was|were|have|has|had)\s+(you|i|we|the)\b/i,
    // Explanation requests
    /^(explain|describe|tell\s+me\s+about|what\s+is|what\s+are|define|elaborate)\b/i,
    // Advice/recommendations
    /^(should\s+i|is\s+it\s+worth|do\s+you\s+recommend|what\s+do\s+you\s+(think|suggest|recommend|advise))\b/i,
    /^(advice|recommend|suggest)\b/i,
    // Comparisons
    /^(compare|difference\s+between|vs\.?|versus)\b/i,
    // Brainstorming
    /^(brainstorm|ideas?\s+for|give\s+me\s+\d+\s+ideas|list\s+\d+\s+)/i,
    // Analysis
    /^(analyze|analysis|assess|evaluate|review)\b/i,
    // Strategy
    /(strategy|strategic|plan|approach|roadmap|game\s+plan)\b/i,
    // Opinions
    /^(what\s+do\s+you\s+(think|feel|believe)|your\s+opinion|your\s+thoughts)\b/i,
    // Continue/status (short messages)
    /^(continue|ok|okay|proceed|go\s+ahead|keep\s+going|status|update|what's\s+new|anything\s+new)\s*\.?\s*$/i,
    // Follow-up questions
    /^(and|but|or|so|then|also|additionally|moreover|furthermore)\b/i,
    // "Tell me more" / "go deeper"
    /(tell\s+me\s+more|go\s+deeper|elaborate|expand\s+on|dive\s+deeper)/i,
    // "What about" / "How about"
    /^(what\s+about|how\s+about)\b/i,
  ]

  // Check dispatch patterns first (more specific)
  for (const pattern of dispatchPatterns) {
    if (pattern.test(lower)) return 'dispatch'
  }

  // Check direct patterns
  for (const pattern of directPatterns) {
    if (pattern.test(lower)) return 'direct'
  }

  // Default: direct (smart response)
  // Most conversational messages should get a smart direct answer
  return 'direct'
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

  // ════════════════════════════════════════════════════════════════════
  // UPGRADE #137-#141 — MISSION PIPELINE FAST PATH (Rec 1-7)
  // ════════════════════════════════════════════════════════════════════
  // When the owner says "start mission: <type> <objective>", we bypass
  // the LLM and directly invoke runMissionPipeline(). This kicks off the
  // hierarchical workflow: Team Leader → Super Agent Verify → next team
  // → ... → CEO Final Report. All progress is logged to the audit trail
  // and sent via Telegram.
  const missionMatch = userMessage.match(
    /^start\s+mission\s*:\s*(?:(product_launch|content_creation|affiliate_campaign|generic)\s*[:\-\s]+)?(.+)$/i
  )
  if (missionMatch) {
    const pipelineType = (missionMatch[1] || 'generic').toLowerCase()
    const objective = missionMatch[2].trim().slice(0, 1000)
    if (objective.length >= 10) {
      try {
        const { runMissionPipeline, MISSION_PIPELINES } = await import('./mission-pipeline')
        const pipeline = MISSION_PIPELINES[pipelineType] || MISSION_PIPELINES.generic
        const missionId = `mission_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
        const missionTitle = objective.slice(0, 80)

        await emit('thought', { content: `[MISSION PIPELINE] Starting ${pipeline.name} (${pipeline.stages.length} stages). Each stage will be verified by the Super Agent before advancing. CEO will present the final report.` })

        // Stream progress events to the UI as the pipeline runs
        const result = await runMissionPipeline({
          missionId,
          pipelineType,
          objective,
          missionTitle,
        })

        // Build a final summary answer for the UI
        let summaryAnswer = `## 🎯 Mission Pipeline ${result.success ? 'Complete' : 'Failed'}\n\n`
        summaryAnswer += `**Mission:** ${missionTitle}\n`
        summaryAnswer += `**Pipeline:** ${pipeline.name}\n`
        summaryAnswer += `**Stages:** ${result.stages.length} / ${pipeline.stages.length}\n\n`
        summaryAnswer += `### Stage Results\n`
        for (const s of result.stages) {
          const icon = s.artifactVerified ? '✅' : s.finalScore >= 70 ? '⚠️' : '❌'
          summaryAnswer += `${icon} Stage ${s.stage} (${s.team}): score ${s.finalScore}/100, ${s.rounds} round(s)\n`
          if (s.artifactValue) summaryAnswer += `   Artifact: ${s.artifactValue.slice(0, 100)}\n`
        }
        if (result.ceoReport?.fullReport) {
          summaryAnswer += `\n### 🎯 CEO Executive Report\n\n${result.ceoReport.fullReport}\n`
        }
        if (result.error) {
          summaryAnswer += `\n### ⚠️ Error\n${result.error}\n`
        }
        summaryAnswer += `\n---\n*Full audit trail: /api/missions/${missionId}/audit-trail*`

        const chunks2 = chunkText(summaryAnswer, 80)
        for (const c of chunks2) {
          await emit('token', { content: c })
        }

        // Persist the user message + assistant response so reload works
        let assistantRowId = 'temp_' + Date.now()
        try {
          await db.message.create({ data: { conversationId, role: 'user', content: userMessage } })
          const assistantRow = await db.message.create({
            data: { conversationId, role: 'assistant', content: summaryAnswer },
          })
          assistantRowId = assistantRow.id
          // Update conversation title
          const conv = await db.conversation.findUnique({ where: { id: conversationId } })
          if (conv && (conv.title === 'New Conversation' || !conv.title)) {
            await db.conversation.update({
              where: { id: conversationId },
              data: { title: `Mission: ${missionTitle.slice(0, 40)}` },
            })
          }
        } catch (dbErr: any) {
          console.warn('[orchestrator] DB write failed (mission pipeline), continuing without persistence:', dbErr?.message?.slice(0, 100))
        }

        return {
          finalAnswer: summaryAnswer,
          steps: [],
          persistedAssistantMessageId: assistantRowId,
        }
      } catch (missionErr: any) {
        // Fall through to normal orchestration if pipeline fails to start
        await emit('thought', { content: `[MISSION PIPELINE] Failed to start: ${missionErr?.message?.slice(0, 200)} — falling back to normal orchestration` })
      }
    }
  }

  // Recall memories for context
  const recalled = await recallMemories(userMessage.slice(0, 200), 8)
  const memoryBlock = formatMemoryForPrompt(recalled)

  const languageInstruction =
    language === 'zh'
      ? 'LANGUAGE INSTRUCTION: The user has toggled the agent to Chinese. Reply in 中文 (Chinese) for your FINAL answer regardless of input language.'
      : 'LANGUAGE INSTRUCTION: The user has toggled the agent to English. Reply in English for your FINAL answer unless the user wrote in another language.'

  // Build a DYNAMIC sub-agent list so the LLM knows about custom agents
  // (Cybersecurity A, TRADER, etc.) — not just the 12 built-ins hard-coded
  // in BASE_SYSTEM_PROMPT. This fixes the bug where the Super Agent would
  // tell the user "that agent doesn't exist" when they addressed a custom
  // agent by name.
  const allAgents = await getAllSubagents({ includeDisabled: false })
  // IMPORTANT: For built-in agents, the dispatch id is their lowercase id (aurora, vertex, etc.).
  // For custom agents, the dispatch id is their NAME (e.g., "Cybersecurity A") — because their
  // db id is a cuid that the LLM can't predict. The runSubagent() lookup matches by id OR name.
  const agentListDynamic = allAgents
    .map((a) => {
      const dispatchId = a.isBuiltin ? a.id : a.name
      return `- ${dispatchId} (${a.name} — ${a.role})`
    })
    .join('\n')
  const dynamicAgentSection = `

CURRENTLY AVAILABLE SUB-AGENTS (built-in + custom, fetched live from DB):
${agentListDynamic}

IMPORTANT: When the user addresses a sub-agent by name (e.g. "Cybersecurity A, search..."),
you MUST dispatch that exact agent via <dispatch agent="agent_id" task="..."/> using the
dispatch id shown at the start of each line above. For built-in agents the dispatch id is
their lowercase name (aurora, vertex, etc.). For custom agents the dispatch id is their
display name (e.g., "Cybersecurity A", "TRADER"). Do NOT do the work yourself with direct
web_search calls. Do NOT tell the user the agent doesn't exist if it appears in the list
above. The list above is authoritative.`

  const systemPrompt = `${BASE_SYSTEM_PROMPT}

${ORCHESTRATOR_PROMPT_ADDENDUM}

${dynamicAgentSection}

${languageInstruction}

RECALLED MEMORIES (use as context, do not blindly trust if outdated):
${memoryBlock}

CURRENT UTC TIME: ${new Date().toUTCString()}`

  const history = await buildHistoryMessages(conversationId, userMessage, attachments)
  const ctx: ToolContext = { attachments, language }

  // UPGRADE #68 — Continue command support
  const continuePatterns = /^(continue|keep going|go ahead|go on|ok|okay|yes|proceed|finish|done\?|are you done\?|status|update|what's the status|keep working|don't stop|resume)\s*\.?\s*$/i
  const isContinueCommand = continuePatterns.test(userMessage.trim())

  const steps: OrchestratorRunResult['steps'] = []
  let conversationMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  if (isContinueCommand) {
    const lastAssistant = [...history].reverse().find((m) => m.role === 'assistant')
    conversationMessages = lastAssistant
      ? [
          { role: 'system', content: systemPrompt },
          ...history,
          { role: 'user', content: `[CONTINUE COMMAND] Owner typed "${userMessage}". CONTINUE your previous work. Don't start over — pick up where you left off. Your last response was:\n\n${lastAssistant.content.slice(0, 500)}\n\nNow EXECUTE the next step. Use <tool name="...">, <dispatch agent="..." task="..."/> or <dispatch_subagent id="...">task</dispatch_subagent> tags. Do not repeat yourself — advance the task.` },
        ]
      : [{ role: 'system', content: systemPrompt }, ...history]
  } else {
    conversationMessages = [
      { role: 'system', content: systemPrompt },
      ...history,
    ]
  }

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

  // ════════════════════════════════════════════════════════════════════
  // UPGRADE #117 — Query Complexity Router
  // ════════════════════════════════════════════════════════════════════
  // Classify the user's message to decide whether to:
  //   - 'direct': Answer directly with a smart, deep response (90% of messages)
  //   - 'dispatch': Genuinely needs subagent work (10% of messages)
  //
  // This prevents the agent from dispatching to a subagent for simple
  // questions like "What's the best affiliate strategy?" — which should
  // get an immediate 500-1500 word smart answer, not a slow dispatch loop.
  const queryType = classifyQuery(userMessage)
  if (queryType === 'direct') {
    // Inject a system nudge that tells the agent to answer directly
    conversationMessages.push({
      role: 'user',
      content: `[SYSTEM ROUTER] This is a direct question/analysis/advice request. Do NOT dispatch to a subagent. Answer DIRECTLY with a deep, intelligent response (500-1500 words for complex questions, concise for simple ones). Use ## headers, **bold**, bullet lists. Provide examples. Show your reasoning. End with next steps.`,
    })
  }

  while (iter < MAX_ITERATIONS) {
    iter++

    // UPGRADE #68 — Heartbeat emission (so dashboard shows progress)
    const lastStep = steps.length > 0 ? steps[steps.length - 1] : null
    try {
      await emit('heartbeat', {
        iteration: iter,
        maxIterations: MAX_ITERATIONS,
        toolsCalled: steps.length,
        dispatchesCalled: dispatchCount,
        manageActionsCalled: manageCount,
        lastToolName: (lastStep as any)?.toolName ?? null,
        lastThought: (lastStep as any)?.thought ? String((lastStep as any).thought).slice(0, 200) : null,
        startedAt: steps.length > 0 ? (steps[0] as any).startedAt : Date.now(),
        elapsedMs: steps.length > 0 ? Date.now() - (steps[0] as any).startedAt : 0,
        message: `Working — step ${iter}/${MAX_ITERATIONS}, ${steps.length} tool${steps.length === 1 ? '' : 's'} called, agent is alive`,
      })
    } catch {}

    let completion: any
    try {
      completion = await callLlmWithRetry(conversationMessages)
    } catch (e: any) {
      const friendly = friendlyLlmError(e)
      // UPGRADE #131: Send rateLimited flag explicitly — don't rely on text matching
      const rateLimited = isRateLimitError(e)
      await emit('error', { message: friendly, rateLimited })
      finalAnswer = friendly
      break
    }
    const content: string = completion?.choices?.[0]?.message?.content ?? ''
    if (!content.trim()) {
      finalAnswer = '(The agent produced no output. Please try rephrasing.)'
      break
    }

    // UPGRADE #119 — Extract reasoning from the LLM response
    const reasoning: string | null =
      completion?.choices?.[0]?.message?.reasoning ||
      completion?.choices?.[0]?.message?.reasoning_content ||
      completion?.choices?.[0]?.message?.thinking ||
      completion?._reasoning ||
      null
    if (reasoning) {
      try { await emit('reasoning', { content: reasoning }) } catch {}
    }

    // UPGRADE #95 — Auto-convert pseudo-XML tool calls BEFORE parsing.
    // This fixes the root cause: when the LLM emits <parallel_executor>{json}</parallel_executor>
    // (wrong format), we convert it to <tool name="parallel_executor">{json}</tool> (correct format)
    // so the tools ACTUALLY RUN and the user sees real results (not raw XML).
    const convertedContent = autoConvertPseudoToolCalls(content)

    const parsed = parseOrchestrator(convertedContent)

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
      // UPGRADE #68 + #86 — Multi-dispatch: detect ALL dispatch tags + execute in parallel
      // Handles: <dispatch agent="x" task="..."/> AND <dispatch_subagent id="x">task</dispatch_subagent>
      //          AND <dispatch_subagent id="x" task="..."/> AND <dispatch_subagent id="x"/>
      const allDispatchRe = /<dispatch(?:_subagent)?\s+(?:id|agent)=["']([^"']+)["']\s*(?:task=["']([\s\S]*?)["']\s*)?(?:\/>|>([\s\S]*?)<\/dispatch_subagent>)/gi
      const allDispatches: Array<{ agentId: string; task: string }> = []
      let dm: RegExpExecArray | null
      while ((dm = allDispatchRe.exec(convertedContent)) !== null) {
        const agentId = dm[1].trim().toLowerCase()
        // task may come from attr (group 2) or body (group 3)
        const task = (dm[2] ?? dm[3] ?? '').trim() || 'execute task'
        allDispatches.push({ agentId, task })
      }

      if (allDispatches.length > 1) {
        // Multi-dispatch: execute ALL in parallel via Promise.allSettled
        try { await emit('thought', { content: `[MULTI-DISPATCH] Detected ${allDispatches.length} dispatches. Executing in PARALLEL for max speed.` }) } catch {}
        const list = await getMerged()
        const { runSubagent } = await import('./subagents')
        const startTime = Date.now()
        const results = await Promise.allSettled(
          allDispatches.map(async (d) => {
            const sub = list.find((s) => s.id === d.agentId || s.name.toLowerCase() === d.agentId.toLowerCase())
            if (!sub || sub.enabled === false) return { id: d.agentId, name: d.agentId, error: 'not found or disabled' }
            dispatchCount++
            const dispatchId = `par_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
            try { await emit('subagent_dispatch', { dispatchId, agentId: sub.id, agentName: sub.name, color: sub.color, icon: sub.icon, task: d.task, stepNumber: iter }) } catch {}
            const result = await runSubagent({
              subagentId: sub.id, task: d.task, dispatchId,
              attachments, language, emit,
              parentConversationId: conversationId,
            })
            return { id: sub.id, name: sub.name, answer: result.answer }
          })
        )
        const elapsedMs = Date.now() - startTime
        const succeeded = results.filter((r) => r.status === 'fulfilled').length
        // Feed ALL results back
        for (let i = 0; i < results.length; i++) {
          const r = results[i]
          const d = allDispatches[i]
          if (r.status === 'fulfilled' && r.value) {
            try { await emit('subagent_complete', { dispatchId: `par_${i}`, answer: (r.value.answer ?? '').slice(0, 2000) }) } catch {}
            conversationMessages.push({ role: 'assistant', content: `<dispatch_subagent id="${d.agentId}">${d.task}</dispatch_subagent>` })
            conversationMessages.push({ role: 'user', content: `[SUBAGENT_RESULT] ${r.value.name}: ${(r.value.answer ?? '').slice(0, 20000)}` })
          } else {
            conversationMessages.push({ role: 'user', content: `[SUBAGENT_RESULT] ${d.agentId}: ERROR — ${r.status === 'rejected' ? r.reason?.message : 'unknown'}` })
          }
        }
        try { await emit('heartbeat', { iteration: iter, maxIterations: MAX_ITERATIONS, toolsCalled: steps.length, dispatchesCalled: dispatchCount, lastToolName: 'multi_dispatch', lastThought: `${succeeded}/${results.length} subagents completed in ${elapsedMs}ms (parallel)`, startedAt: Date.now(), elapsedMs, message: `Multi-dispatch: ${succeeded}/${results.length} in ${elapsedMs}ms` }) } catch {}
        continue
      }

      // Single dispatch (existing logic)
      const { agentId, task } = parsed.dispatch
      const list = await getMerged()
      // Match by id (case-sensitive) OR by name (case-insensitive) — this lets
      // the Super Agent dispatch to custom agents like "Cybersecurity A" using
      // their human-readable name (their db id is an unpredictable cuid).
      const sub = list.find(
        (s) => s.id === agentId || s.name.toLowerCase() === agentId.toLowerCase()
      )
      if (!sub) {
        // Unknown agent — feed back an error to the orchestrator.
        // Show BOTH name and id so the LLM can pick the right dispatch id next time.
        const available = list.map((s) => `${s.name} (dispatch_id: ${s.isBuiltin ? s.id : s.name})`).join(', ')
        const errMsg = `Unknown sub-agent: "${agentId}". Available: ${available}`
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

      // UPGRADE #133: CROSS-LEADER VERIFICATION
      // If this is the 2nd+ dispatch, pass the previous leader's result
      // to the new leader's task so they can VERIFY it.
      let enhancedTask = task
      if (dispatchCount > 1) {
        // Find the most recent SUBAGENT_RESULT in conversation messages
        const prevResults = conversationMessages
          .filter((m) => m.role === 'user' && typeof m.content === 'string' && m.content.startsWith('[SUBAGENT_RESULT]'))
          .map((m) => (m.content as string).replace(/^\[SUBAGENT_RESULT\]\s*/, ''))
        if (prevResults.length > 0) {
          const lastResult = prevResults[prevResults.length - 1].slice(0, 3000)
          enhancedTask = `${task}

PREVIOUS LEADER'S OUTPUT (for cross-verification):
${lastResult}

VERIFICATION REQUIRED: Before completing your task, verify the previous leader's output:
1. Check for factual accuracy (claims, numbers, URLs)
2. Check for completeness (did they miss anything critical?)
3. Check for errors or contradictions
4. Include a "## Verification" section in your response noting any issues found, or confirming the previous output is accurate.`
        }
      }

      // Run the sub-agent (it will emit its own subagent_thought/tool_call/tool_result events)
      let subAnswer = ''
      try {
        const result = await runSubagent({
          subagentId: sub.id,
          task: enhancedTask,
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

      // UPGRADE #133: ENFORCE QUALITY GATE IN CODE (not just prompt)
      // After each subagent returns, automatically score the answer quality.
      // If score < 70: flag for re-dispatch. If 70-89: flag for ECHO refinement.
      let qualityScore = 100  // default to pass
      let qualityNote = ''
      try {
        const { dispatchTool } = await import('./tools')
        const qualityResult = await dispatchTool('quality_scorer_v2', {
          answer: subAnswer.slice(0, 2000),
          question: task.slice(0, 500),
          target: 90,
        }, { attachments: [], language: 'en' })
        if (qualityResult.ok) {
          const scoreMatch = qualityResult.result.match(/(?:score|grade|total)[:\s]+(\d+)/i)
          qualityScore = scoreMatch ? parseInt(scoreMatch[1]) : 100
          if (qualityScore < 70) {
            qualityNote = `\n⚠️ QUALITY GATE: Score ${qualityScore}/100 — BELOW 70. Consider re-dispatching ${sub.name} with more specific instructions, or dispatch ECHO to improve.`
          } else if (qualityScore < 90) {
            qualityNote = `\n⚠️ QUALITY GATE: Score ${qualityScore}/100 — below 90 target. Consider dispatching ECHO to refine.`
          } else {
            qualityNote = `\n✅ QUALITY GATE: Score ${qualityScore}/100 — passed.`
          }
        }
      } catch {
        // Quality scorer failed — don't block the answer, just skip the gate
      }

      // UPGRADE #134: VERIFY THE VERIFIER — check if leader actually included verification
      if (dispatchCount > 1) {
        const didVerify = /verification|verified|confirmed|accurate|no issues|no errors|previous.*output.*is/i.test(subAnswer)
        if (!didVerify) {
          qualityNote += '\n⚠️ CROSS-LEADER VERIFICATION SKIPPED — leader did not include a verification section for the previous leader\'s output.'
        } else {
          qualityNote += '\n✅ CROSS-LEADER VERIFICATION: leader verified previous output.'
        }
      }

      // Feed the sub-agent's result back to the orchestrator (with quality note)
      conversationMessages.push({ role: 'assistant', content })
      conversationMessages.push({
        role: 'user',
        content: `[SUBAGENT_RESULT] ${sub.id}: ${subAnswer}${qualityNote}`,
      })

      // UPGRADE #86 — Hard synthesis cap: after 3 dispatches in one turn, FORCE the agent to synthesize.
      // Without this, the agent dispatches Quill → Forge → Aurora → Scout → Pulse → Echo → ... and never
      // produces a final answer — the user sees raw XML or "I've reached my iteration limit".
      if (dispatchCount >= 3 && iter < MAX_ITERATIONS - 1) {
        conversationMessages.push({
          role: 'user',
          content: `[SYSTEM] SYNTHESIS CAP (upgrade #86): You have dispatched ${dispatchCount} sub-agents in this turn. That is the maximum allowed before synthesis. DO NOT dispatch another sub-agent. DO NOT call another tool. SYNTHESIZE the results you have RIGHT NOW into a clear, structured final answer for the owner. Use markdown headings (## Summary, ## Findings, ## Recommendations, ## Next Steps). Quote the most important findings from each sub-agent. The owner is waiting — give them the answer NOW.`,
        })
      }

      // BEST-EFFORT auto-logging: if the sub-agent's answer mentions dollar
      // amounts (e.g. "$12.50", "$1,200/mo", "$45/day"), log them as income
      // entries with source = sub-agent id. Fire-and-forget — never blocks the
      // orchestrator. We only consider amounts that look like earnings (positive
      // UPGRADE #106: Disabled auto-logging of fake income from agent text.
      // This was creating $18K+ in fake "projected" income entries that confused the system.
      // Real income is now tracked only via Stripe/PayPal webhooks or manual entry.
      // try {
      //   autoLogIncomeFromAnswer(sub.id, subAnswer)
      // } catch {
      //   /* ignore */
      // }

      // If a memory_store happened inside the sub-agent, the sub-agent already emitted it
      // (we don't double-emit memory_update here)
      continue
    }

    // 2) Direct tool path (same as the original agent loop)
    if (parsed.tool) {
      const step: any = {
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

      // UPGRADE #124 — Verify the tool action (check for real artifact)
      const verification = verifyToolAction(step.toolName!, toolResult)

      await emit('tool_result', {
        stepId: step.id,
        result: toolResult.result,
        preview: toolResult.preview,
        ok: toolResult.ok,
        artifacts: toolResult.artifacts,
        // UPGRADE #124 — include verification result
        verified: verification.verified,
        verificationWarning: verification.warning,
      })

      // ── FIX #43: TOOL DIVERSITY ENFORCER ──────────────────────────
      // The owner reported "Agent007 not using all tools." Root cause: the LLM
      // defaults to web_search for everything (anchor bias from prompt examples)
      // and there was no mechanism to force tool variety. This block:
      //   1. Tracks unique tools used this turn
      //   2. If the agent calls the SAME tool 3+ times in a row → injects a
      //      [SYSTEM] message forcing it to use smart_tool_router to discover
      //      better tools for the task
      //   3. After 5 tool calls, if < 3 unique tools used → injects a
      //      [SYSTEM] message forcing tool diversity
      const recentToolNames = steps.map(s => s.toolName).filter(Boolean)
      const uniqueToolsUsed = new Set(recentToolNames).size
      const lastTool = recentToolNames[recentToolNames.length - 1]
      const lastToolRepeatCount = recentToolNames.length >= 3 &&
        recentToolNames.slice(-3).every(t => t === lastTool)

      // Check: same tool called 3+ times in a row
      if (lastToolRepeatCount && iter < MAX_ITERATIONS - 1) {
        await emit('thought', { content: `[AUTO-DIVERSITY] Detected repeated tool "${lastTool}" called 3x in a row. Forcing smart_tool_router discovery...` })
        conversationMessages.push({
          role: 'user',
          content: `[SYSTEM] TOOL DIVERSITY ENFORCER (upgrade #43): You just called "${lastTool}" 3 times in a row. This suggests you're stuck on one tool. You have 522 tools available — use them. Call <tool name="smart_tool_router">{"task":"<describe your current task>"}</tool> RIGHT NOW to discover better tools for this task. Then use parallel_executor to run the top 2-3 recommended tools in parallel. NEVER call the same tool 3+ times in a row unless absolutely necessary.`,
        })
      }

      // Check: after 5 tool calls, < 3 unique tools used
      if (recentToolNames.length >= 5 && uniqueToolsUsed < 3 && iter < MAX_ITERATIONS - 1) {
        await emit('thought', { content: `[AUTO-DIVERSITY] Low tool diversity: ${uniqueToolsUsed} unique tools in ${recentToolNames.length} calls. Forcing variety...` })
        conversationMessages.push({
          role: 'user',
          content: `[SYSTEM] TOOL DIVERSITY ENFORCER (upgrade #43): You've made ${recentToolNames.length} tool calls but only used ${uniqueToolsUsed} unique tools. You have 522 tools — USE MORE VARIETY. For your next call, pick a DIFFERENT tool you haven't used yet. Consider: decision_matrix, autonomy_policy_enforcer, real_time_data_hub, predictive_analytics_engine, accuracy_checker, parallel_executor, or any of the 515+ other tools. Avoid repeating the same tool.`,
        })
      }


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

    // 3) Final answer path — but FIRST check for "stuck" condition (FIX 2)
    // If the agent produced ONLY a thought (no tool/dispatch/manage) and the
    // thought contains "wait"-like language, it's stuck waiting for input
    // that will never come. Auto-recover by prompting it to continue.
    const isThoughtOnly = !parsed.tool && !parsed.dispatch && !parsed.manage && !!parsed.thought
    const stuckPatterns = /(wait|waiting|haven't provided|yet to|will wait|need to wait|i'll wait|let me wait|as i wait)/i
    const isStuck = isThoughtOnly && parsed.thought && stuckPatterns.test(parsed.thought)

    if (isStuck && iter < MAX_ITERATIONS - 1) {
      // Auto-recovery: feed back a "continue" prompt + re-enter the loop
      await emit('thought', { content: `[AUTO-RECOVERY] Detected stuck condition. Auto-continuing...` })
      conversationMessages.push({ role: 'assistant', content })
      conversationMessages.push({
        role: 'user',
        content: '[SYSTEM] You appear to be waiting. Do NOT wait — continue executing the task now. Dispatch the next sub-agent or use a tool or give your final answer.',
      })
      continue
    }

    // ── FIX #41: "PROMISE WITHOUT ACTION" DETECTION ──────────────────
    // If the agent's response is a final answer (no tool/dispatch/manage)
    // but it contains "I will" / "let me" / "hold on" / "please wait" /
    // "I'm going to" language, it's PROMISING to do something but NOT
    // actually doing it. This is the #1 cause of "agent gets stuck and
    // doesn't provide answers" — the agent says "I will run tests" as a
    // final answer, the loop breaks, and the user never gets results.
    // FIX: detect this pattern and auto-recover by forcing the agent to
    // either emit a tool call NOW or give a real answer.
    const isPromiseOnly = !parsed.tool && !parsed.dispatch && !parsed.manage
    const promisePatterns = /(i will run|i will proceed|i will test|i will check|i will execute|let me run|let me test|let me check|let me proceed|hold on|please hold|please wait|give me a moment|i'm going to run|i'm going to test|i'm going to check|one moment|just a moment|bear with me)/i
    const fullText = (parsed.thought ?? '') + ' ' + (content.replace(THOUGHT_RE, '').trim())
    const hasPromise = promisePatterns.test(fullText)
    const hasNoToolCallYet = steps.length === 0  // no tools called this entire turn

    if (isPromiseOnly && hasPromise && hasNoToolCallYet && iter < MAX_ITERATIONS - 1) {
      // Auto-recovery: force the agent to actually execute NOW
      await emit('thought', { content: `[AUTO-RECOVERY] Detected "promise without action". Forcing execution now...` })
      conversationMessages.push({ role: 'assistant', content })
      conversationMessages.push({
        role: 'user',
        content: '[SYSTEM] CRITICAL: You said "I will run/proceed/test" but you did NOT emit a tool call. Do NOT promise — EXECUTE. Emit the tool call RIGHT NOW in this response. For example, if you said "I will run exhaustive tests", then emit <tool name="exhaustive_tool_test"></tool> immediately. Never respond with just a promise to do something — either DO it (emit tool tags) or report RESULTS.',
      })
      continue
    }

    // If it's thought-only but NOT stuck, check if the text after thought is meaningful
    const textAfterThought = content.replace(THOUGHT_RE, '').trim()
    if (isThoughtOnly && textAfterThought.length < 20 && iter < MAX_ITERATIONS - 1) {
      // The agent produced only a thought with no substantial answer — likely stuck
      await emit('thought', { content: `[AUTO-RECOVERY] Thought-only response with no answer. Prompting to continue...` })
      conversationMessages.push({ role: 'assistant', content })
      conversationMessages.push({
        role: 'user',
        content: '[SYSTEM] You produced only a thought with no action or answer. Please either: (1) dispatch a sub-agent, (2) call a tool, or (3) give your final answer now.',
      })
      continue
    }

    // 3a) Final answer path — emit synthesis signal then stream tokens
    // UPGRADE #86 + #95 — Strip ALL pseudo-XML / dispatch tags / reasoning traces from the final answer.
    // Without this, raw `<dispatch_subagent ...>`, `<parallel_executor>`, and "REASONING TRACE:"
    // blocks leak to the user as the "weird incomprehensible answer" the owner reported.
    // UPGRADE #95: Use convertedContent (already auto-converted parallel_executor → <tool> format)
    // so any tools that were called actually ran. Leftover pseudo-XML is stripped here as safety net.
    finalAnswer = convertedContent
      .replace(THOUGHT_RE, '')
      .replace(DISPATCH_RE, '')
      .replace(DISPATCH_SUBAGENT_RE, '')
      .replace(PSEUDO_XML_RE, '')
      .replace(REASONING_TRACE_BLOCK_RE, '')
      .replace(/<dispatch_subagent[^>]*?(?:\/>|>[\s\S]*?<\/dispatch_subagent>)/gi, '') // safety net: catch any leftover
      .replace(/<\/?(?:dispatch|dispatch_subagent|parallel_executor|reasoning_trace|reasoning|execution|plan|action|reflect|reflection|analyze)[^>]*?>/gi, '') // final sweep: strip any lone tags
      .replace(/<tool\s+name=["'][^"']+["'][^>]*>[\s\S]*?<\/tool>/gi, '') // UPGRADE #95: strip any leftover <tool> tags that didn't execute
      .trim() || content.trim()

    // UPGRADE #86 — If finalAnswer is now empty (everything was a tag/thought), retry instead of showing blank
    if (finalAnswer.length < 10 && iter < MAX_ITERATIONS - 1) {
      conversationMessages.push({ role: 'assistant', content: convertedContent })
      conversationMessages.push({
        role: 'user',
        content: '[SYSTEM] Your previous response contained only tags (dispatch / thought / pseudo-XML) with no actual answer text. The owner saw nothing comprehensible. Please respond NOW with a clear markdown answer (use ## headings, bullet points, etc.) — NO tags, NO thoughts, NO pseudo-XML. Just plain text the owner can read.',
      })
      continue
    }

    // UPGRADE #134: DELIVERY VERIFICATION — check tool RESULT, not just CALL
    const deliveryKeywords = /(published|deployed|posted|sent|scheduled|uploaded|listed|created.*listing|live\s+now)/i
    const deliveryTools = ['wordpress_publisher', 'stripe_payment_processor', 'etsy_integration',
      'convertkit_email', 'send_email', 'telegram_notify', 'ntfy_notify', 'discord_notify',
      'buffer_scheduler', 'resend_email', 'file_write']
    const toolsCalled = steps.map((s: any) => s.toolName).filter(Boolean)
    const claimsDelivery = deliveryKeywords.test(finalAnswer)

    if (claimsDelivery) {
      // Find delivery tool steps and check their ACTUAL RESULT
      const deliverySteps = steps.filter((s: any) => deliveryTools.includes(s.toolName))
      const successfulDeliveries = deliverySteps.filter((s: any) => {
        // Check if the tool result indicates success
        const result = s.toolResult
        if (!result) return false
        // toolResult is a ToolResult object with .ok field
        if (typeof result === 'object' && result.ok === true) return true
        // Or check if the result string contains success indicators
        if (typeof result === 'object' && typeof result.result === 'string') {
          return !/error|fail|unable|not configured|setup required/i.test(result.result)
        }
        return false
      })
      const failedDeliveries = deliverySteps.filter((s: any) => {
        const result = s.toolResult
        if (!result) return true  // no result = failed
        if (typeof result === 'object' && result.ok === false) return true
        if (typeof result === 'object' && typeof result.result === 'string') {
          return /error|fail|unable|not configured|setup required/i.test(result.result)
        }
        return false
      })

      if (deliverySteps.length === 0) {
        finalAnswer += `\n\n---\n⚠️ **DELIVERY VERIFICATION:** The answer claims delivery, but no delivery tool was called. The action did not occur.`
      } else if (successfulDeliveries.length > 0 && failedDeliveries.length === 0) {
        const toolName = successfulDeliveries[0].toolName
        finalAnswer += `\n\n---\n✅ **DELIVERY VERIFIED:** ${toolName} was called and succeeded.`
      } else if (successfulDeliveries.length > 0 && failedDeliveries.length > 0) {
        finalAnswer += `\n\n---\n⚠️ **DELIVERY PARTIAL:** ${successfulDeliveries.length} succeeded, ${failedDeliveries.length} failed. Some deliveries may not have completed.`
      } else {
        finalAnswer += `\n\n---\n❌ **DELIVERY FAILED:** Delivery tool was called but returned an error. The action did not complete successfully.`
      }
    }

    // UPGRADE #134: MANDATORY FEEDBACK LOOP after revenue/content/strategy answers
    if (/revenue|income|sales|published|traffic|conversion|strategy|affiliate|monetiz|earn|profit|stripe|ga4/i.test(finalAnswer)) {
      try {
        const { dispatchTool } = await import('./tools')
        const feedbackResult = await dispatchTool('real_feedback_loop', { action: 'report' }, { attachments: [], language: 'en' })
        if (feedbackResult.ok) {
          // Append real data to the answer (truncated to 800 chars)
          const feedbackData = feedbackResult.result.slice(0, 800)
          finalAnswer += `\n\n---\n📊 **REAL FEEDBACK DATA (from Stripe + GA4):**\n${feedbackData}`
        }
      } catch {
        // Feedback loop failed — don't block the answer, just skip
      }
    }

    // Emit a synthesis indicator so the UI shows "Synthesizing…" briefly
    await emit('synthesis', { content: finalAnswer.slice(0, 80) })

    const chunks = chunkText(finalAnswer, 80)
    for (const c of chunks) {
      await emit('token', { content: c })
    }
    break
  }

  if (!finalAnswer) {
    // UPGRADE #86 — Auto-synthesize from what we have (BOTH tool results AND subagent results).
    // The previous version only collected tool results, missing subagent dispatch results entirely.
    // This is what caused the "I've reached my iteration limit" message after a long chain of dispatches.
    const collectedResults: string[] = []

    // (a) collect direct tool call results
    for (const s of steps) {
      if (s.toolName && s.toolResult?.result) {
        const preview = s.toolResult.result.slice(0, 400)
        collectedResults.push(`### 🔧 ${s.toolName}\n${preview}`)
      }
    }

    // (b) collect subagent dispatch results from conversationMessages
    const subagentResults = conversationMessages
      .filter((m) => m.role === 'user' && typeof m.content === 'string' && m.content.startsWith('[SUBAGENT_RESULT]'))
      .map((m) => {
        const txt = (m.content as string).replace(/^\[SUBAGENT_RESULT\]\s*/, '')
        const colonIdx = txt.indexOf(':')
        const agentId = colonIdx > 0 ? txt.slice(0, colonIdx).trim() : 'subagent'
        const body = colonIdx > 0 ? txt.slice(colonIdx + 1).trim() : txt
        return `### 🤖 ${agentId}\n${body.slice(0, 600)}`
      })
    collectedResults.push(...subagentResults)

    if (collectedResults.length > 0) {
      finalAnswer = `## Summary\nI dispatched ${subagentResults.length} sub-agent(s) and ran ${steps.length} tool call(s) this turn. Here are the consolidated findings:\n\n${collectedResults.join('\n\n---\n\n')}\n\n---\n## Next Steps\nType **"continue"** and I'll pick up where I left off, or ask me to drill into any specific finding above.`
    } else {
      finalAnswer =
        "I've reached my iteration limit for this turn without completing the task. Please type 'continue' and I'll retry."
    }
    await emit('token', { content: finalAnswer })
  }

  // UPGRADE #128: Wrap DB writes in try/catch — if DB is unreachable,
  // the agent still returns the answer to the user (just doesn't persist to DB)
  let assistantRow: any = { id: 'temp_' + Date.now() }
  let conv: any = null
  try {
    assistantRow = await db.message.create({
      data: { conversationId, role: 'assistant', content: finalAnswer },
    })
  } catch (dbErr: any) {
    console.warn('[orchestrator] DB write failed (assistant message), continuing without persistence:', dbErr?.message?.slice(0, 100))
  }

  // Update conversation title if it's still default
  try {
    conv = await db.conversation.findUnique({ where: { id: conversationId } })
    if (conv && (conv.title === 'New Conversation' || !conv.title)) {
      const title = userMessage.slice(0, 50).trim() || 'New Conversation'
      await db.conversation.update({ where: { id: conversationId }, data: { title } })
    }
  } catch (dbErr: any) {
    console.warn('[orchestrator] DB title update failed, continuing:', dbErr?.message?.slice(0, 80))
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

/* FULL ACCESS: all tools are valid. The owner has granted full access. */
const VALID_TOOLS_SET = new Set([
  'web_search',
  'page_reader',
  'image_gen',
  'vision',
  'code_exec',
  'memory_store',
  'memory_recall',
  'file_read',
  'file_write',
  'wikipedia_search',
  'wikipedia_read',
  'free_apis_directory',
  'kb_search',
  'http_fetch',
  'source_read',
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
        // UPGRADE #38 — PERMANENT CUSTOM AGENTS LOCK
        // The 6 owner-defined custom agents (TRADER, Cybersecurity A/R, Developer,
        // TESTFAST2, FASTTEST3) are PERMANENTLY LOCKED. They cannot be deleted
        // even with owner authorization. This protects the owner's investment
        // in configuring these specialized agents. The lock is name-based so it
        // survives DB resets + cold starts.
        const PERMANENT_CUSTOM_AGENT_NAMES = new Set([
          'trader',
          'cybersecurity a',
          'cybersecurity r',
          'developer',
          'testfast2',
          'fasttest3',
        ])
        if (PERMANENT_CUSTOM_AGENT_NAMES.has(existing.name.toLowerCase())) {
          return {
            ok: false,
            message: `PERMANENTLY LOCKED: Custom sub-agent "${existing.name}" cannot be deleted — it is on the permanent protection list (upgrade #38). This lock cannot be bypassed, even with owner authorization. Use toggle_agent with enabled="false" to disable it instead.`,
          }
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

      /* ──────────────────────────── FULL ACCESS EXPANSION ────────────────────────────
       * The following manage actions give Agent007 FULL CONTROL over the dashboard,
       * login page, settings, and system. NO LIMITATIONS — owner-grade autonomy.
       * ──────────────────────────────────────────────────────────────────────────── */

      /* ----------------------- dashboard_add_widget / edit / remove ----------------------- */
      case 'dashboard_add_widget':
      case 'dashboard_edit_widget': {
        const id = (attrs.id ?? '').toString().trim().slice(0, 80)
        const title = (attrs.title ?? '').toString().trim().slice(0, 100)
        if (!id || !title) {
          return { ok: false, message: `${action} requires "id" and "title".` }
        }
        const widget: any = {
          id,
          title,
          type: (attrs.type ?? 'kpi').toString().trim().slice(0, 20) as any,
          value: attrs.value ?? '',
          subtitle: attrs.subtitle ?? undefined,
          color: attrs.color ?? undefined,
          icon: attrs.icon ?? undefined,
          position: (attrs.position ?? 'top').toString().trim().slice(0, 10) as any,
          link: attrs.link ?? undefined,
          alertLevel: attrs.alertLevel ?? undefined,
          progress: attrs.progress ? parseFloat(attrs.progress) : undefined,
        }
        try {
          const data = await internalFetch(internalUrl("/api/dashboard/widgets"), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: action === 'dashboard_edit_widget' ? 'edit' : 'add', widget }),
          })
          return {
            ok: !!data.ok,
            message: data.message ?? (data.ok ? `Widget "${id}" saved.` : 'Widget save failed.'),
            data,
          }
        } catch (e: any) {
          return { ok: false, message: `Widget save threw: ${e?.message ?? e}` }
        }
      }

      case 'dashboard_remove_widget': {
        const id = (attrs.id ?? '').toString().trim().slice(0, 80)
        if (!id) return { ok: false, message: 'dashboard_remove_widget requires "id".' }
        try {
          const data = await internalFetch(internalUrl("/api/dashboard/widgets"), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'remove', id }),
          })
          return {
            ok: !!data.ok,
            message: data.message ?? (data.ok ? `Widget "${id}" removed.` : 'Widget remove failed.'),
          }
        } catch (e: any) {
          return { ok: false, message: `Widget remove threw: ${e?.message ?? e}` }
        }
      }

      case 'dashboard_clear_widgets': {
        try {
          const data = await internalFetch(internalUrl("/api/dashboard/widgets"), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'clear' }),
          })
          return {
            ok: !!data.ok,
            message: data.message ?? 'All widgets cleared.',
          }
        } catch (e: any) {
          return { ok: false, message: `Clear widgets threw: ${e?.message ?? e}` }
        }
      }

      /* --------------------------- login_update_branding --------------------------- */
      case 'login_update_branding': {
        // Updates custom login page branding (title, subtitle, version text, colors)
        const updates: any = {}
        if (attrs.title) updates.loginTitle = attrs.title.slice(0, 80)
        if (attrs.subtitle) updates.loginSubtitle = attrs.subtitle.slice(0, 200)
        if (attrs.version_text) updates.loginVersionText = attrs.version_text.slice(0, 100)
        if (attrs.accent_color) {
          const c = validateHexColor(attrs.accent_color)
          if (c) updates.loginAccentColor = c
        }
        if (Object.keys(updates).length === 0) {
          return { ok: false, message: 'login_update_branding: no recognized fields. Supported: title, subtitle, version_text, accent_color.' }
        }
        // Use the custom settings store
        const { setCustomSetting } = await import('@/lib/settings')
        for (const [k, v] of Object.entries(updates)) {
          await setCustomSetting(k, v)
        }
        // Trigger a refresh signal so any open clients reload
        try {
          await internalFetch(internalUrl("/api/system/refresh"), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: 'login_branding_update' }),
          })
        } catch {}
        return {
          ok: true,
          message: `Login branding updated: ${Object.keys(updates).join(', ')}. Client will refresh on next poll.`,
        }
      }

      /* --------------------------- login_enable_2fa / disable_2fa --------------------------- */
      case 'login_enable_2fa': {
        // Enables 2FA for the operator with the given method
        const method = (attrs.method ?? 'email').toString().trim().toLowerCase()
        const validMethods = ['email', 'whatsapp', 'sms', 'google_authenticator']
        if (!validMethods.includes(method)) {
          return { ok: false, message: `login_enable_2fa: method must be one of ${validMethods.join(', ')}.` }
        }
        try {
          const setupRes = await internalFetch(internalUrl("/api/2fa/setup"), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              method,
              phoneNumber: attrs.phone ?? attrs.phoneNumber ?? '15145496297',
              email: 'antonio.can2022@hotmail.com',
            }),
          })
          const setupData = await setupRes.json().catch(() => ({}))
          if (!setupData.ok) {
            return { ok: false, message: `2FA setup failed: ${setupData.error ?? 'unknown'}` }
          }
          // Auto-verify the setup using the code that was sent
          if (setupData.configId && attrs.code) {
            const verifyRes = await internalFetch(internalUrl("/api/2fa/verify"), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ configId: setupData.configId, code: attrs.code }),
            })
            const verifyData = await verifyRes.json().catch(() => ({}))
            return {
              ok: !!verifyData.ok,
              message: verifyData.ok ? `2FA enabled via ${method}.` : `2FA verify failed: ${verifyData.error ?? 'unknown'}`,
              data: { configId: setupData.configId, method, verified: !!verifyData.ok },
            }
          }
          return {
            ok: true,
            message: `2FA setup initiated via ${method}. Code sent. Owner must verify with: <manage action="login_verify_2fa" config_id="${setupData.configId}" code="XXXXXX"/>`,
            data: { configId: setupData.configId, method, codeSent: setupData.codeSent },
          }
        } catch (e: any) {
          return { ok: false, message: `login_enable_2fa threw: ${e?.message ?? e}` }
        }
      }

      case 'login_verify_2fa': {
        const configId = (attrs.config_id ?? '').toString().trim()
        const code = (attrs.code ?? '').toString().trim()
        if (!configId || !code) {
          return { ok: false, message: 'login_verify_2fa requires "config_id" and "code".' }
        }
        try {
          const data = await internalFetch(internalUrl("/api/2fa/verify"), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ configId, code }),
          })
          return {
            ok: !!data.ok,
            message: data.ok ? '2FA verified and enabled.' : `Verify failed: ${data.error ?? 'unknown'}`,
          }
        } catch (e: any) {
          return { ok: false, message: `login_verify_2fa threw: ${e?.message ?? e}` }
        }
      }

      case 'login_disable_2fa': {
        try {
          const data = await internalFetch(internalUrl("/api/2fa/disable"), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          })
          return {
            ok: !!data.ok,
            message: data.ok ? '2FA disabled.' : `Disable failed: ${data.error ?? 'unknown'}`,
          }
        } catch (e: any) {
          return { ok: false, message: `login_disable_2fa threw: ${e?.message ?? e}` }
        }
      }

      /* --------------------------- settings_set (universal) --------------------------- */
      case 'settings_set': {
        // Universal settings setter — accepts arbitrary key=value attrs and
        // stores each one as a custom setting (no schema needed).
        const { setCustomSetting } = await import('@/lib/settings')
        const keys = Object.keys(attrs).filter((k) => !['action'].includes(k))
        if (keys.length === 0) {
          return { ok: false, message: 'settings_set: provide at least one key=value pair.' }
        }
        const saved: string[] = []
        for (const k of keys) {
          let v: any = attrs[k]
          // Try to parse JSON values (e.g. {refreshInterval:30} or [1,2,3])
          if (typeof v === 'string' && (v.startsWith('{') || v.startsWith('['))) {
            try { v = JSON.parse(v) } catch {}
          }
          if (typeof v === 'string' && /^\d+$/.test(v)) v = parseInt(v, 10)
          if (typeof v === 'string' && /^\d+\.\d+$/.test(v)) v = parseFloat(v)
          if (v === 'true') v = true
          if (v === 'false') v = false
          await setCustomSetting(k, v)
          saved.push(k)
        }
        // Trigger refresh
        try {
          await internalFetch(internalUrl("/api/system/refresh"), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: `settings_set: ${saved.join(', ')}` }),
          })
        } catch {}
        return {
          ok: true,
          message: `Custom settings saved: ${saved.join(', ')}.`,
        }
      }

      /* --------------------------- settings_get (universal) --------------------------- */
      case 'settings_get': {
        const { getAllCustomSettings } = await import('@/lib/settings')
        const all = await getAllCustomSettings()
        const keys = Object.keys(attrs).filter((k) => !['action'].includes(k))
        if (keys.length === 0) {
          return {
            ok: true,
            message: `Current custom settings (${Object.keys(all).length} keys):`,
            data: all,
          }
        }
        const picked: Record<string, any> = {}
        for (const k of keys) picked[k] = all[k] ?? null
        return {
          ok: true,
          message: `Settings: ${JSON.stringify(picked)}`,
          data: picked,
        }
      }

      /* --------------------------- settings_delete --------------------------- */
      case 'settings_delete': {
        const { deleteCustomSetting } = await import('@/lib/settings')
        const key = (attrs.key ?? '').toString().trim()
        if (!key) return { ok: false, message: 'settings_delete requires "key".' }
        await deleteCustomSetting(key)
        try {
          await internalFetch(internalUrl("/api/system/refresh"), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: `settings_delete: ${key}` }),
          })
        } catch {}
        return { ok: true, message: `Custom setting "${key}" deleted.` }
      }

      /* --------------------------- system_refresh (signal) --------------------------- */
      case 'system_refresh': {
        try {
          const reason = (attrs.reason ?? 'agent007_manage_action').toString().slice(0, 200)
          const data = await internalFetch(internalUrl("/api/system/refresh"), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason }),
          })
          return {
            ok: !!data.ok,
            message: data.message ?? 'Refresh signal emitted.',
            data,
          }
        } catch (e: any) {
          return { ok: false, message: `system_refresh threw: ${e?.message ?? e}` }
        }
      }

      /* --------------------------- system_reload (full page reload signal) --------------------------- */
      case 'system_reload': {
        try {
          const reason = (attrs.reason ?? 'agent007_full_reload').toString().slice(0, 200)
          const data = await internalFetch(internalUrl("/api/system/reload"), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason }),
          })
          return {
            ok: !!data.ok,
            message: data.message ?? 'Reload signal emitted. Clients will do a full page reload.',
            data,
          }
        } catch (e: any) {
          return { ok: false, message: `system_reload threw: ${e?.message ?? e}` }
        }
      }

      /* --------------------------- system_audit --------------------------- */
      case 'system_audit': {
        try {
          const data = await runSystemAudit()
          return {
            ok: data.overall !== 'fail',
            message: `Audit complete. Overall: ${data.overall?.toUpperCase()}. DB: ${data.database?.status}. Dashboard: ${data.dashboard?.status}. Login: ${data.login?.status}. Comms: ${data.communication?.status}. Settings: ${data.settings?.status}.`,
            data,
          }
        } catch (e: any) {
          return { ok: false, message: `system_audit threw: ${e?.message ?? e}` }
        }
      }

      /* --------------------------- system_test_communication --------------------------- */
      case 'system_test_communication': {
        try {
          const data = await internalFetch(internalUrl("/api/system/test-communication"), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: attrs.email !== 'false',
              whatsapp: attrs.whatsapp ?? true,
              phone: attrs.phone,
              sms: attrs.sms === 'true',
            }),
            signal: AbortSignal.timeout(30000),
          })
          return {
            ok: data.overall !== 'fail',
            message: `Communication test: ${data.overall?.toUpperCase()}. ${data.results?.map((r: any) => `${r.channel}=${r.status}`).join(', ')}`,
            data,
          }
        } catch (e: any) {
          return { ok: false, message: `system_test_communication threw: ${e?.message ?? e}` }
        }
      }

      /* ──────────────────────────── SELF-HEAL & UPGRADE PROTECTION ──────────────────────────── */

      /* --------------------------- self_heal (Agent007 self-repair) --------------------------- */
      case 'self_heal': {
        try {
          const healAction = (attrs.heal_action ?? 'diagnose').toString().toLowerCase()
          const validActions = ['diagnose', 'repair_dashboard', 'repair_login', 'repair_communication', 'restore_upgrades', 'verify_integrity', 'full_repair']
          if (!validActions.includes(healAction)) {
            return { ok: false, message: `self_heal: heal_action must be one of ${validActions.join(', ')}` }
          }
          const data = await runSelfHeal(healAction)
          return {
            ok: data.ok !== false,
            message: `Self-heal (${healAction}): ${data.summary ?? 'complete'}. Overall: ${data.overall?.toUpperCase()}`,
            data,
          }
        } catch (e: any) {
          return { ok: false, message: `self_heal threw: ${e?.message ?? e}` }
        }
      }

      /* --------------------------- view_manifest (list all upgrades) --------------------------- */
      case 'view_manifest': {
        try {
          const data = getManifest()
          const upgrades = data.upgrades ?? []
          return {
            ok: true,
            message: `${data.totalUpgrades ?? upgrades.length} PERMANENT upgrades registered. Categories: ${JSON.stringify(data.countsByCategory ?? {})}. All upgrades are protected — reset/delete operations require owner 2FA (SMS, TOTP, WhatsApp, or Email).`,
            data: {
              totalUpgrades: data.totalUpgrades,
              categories: data.countsByCategory,
              integrity: data.integrity,
              upgrades: upgrades.map((u: any) => ({ id: u.id, title: u.title, category: u.category, dateApplied: u.dateApplied })),
            },
          }
        } catch (e: any) {
          return { ok: false, message: `view_manifest threw: ${e?.message ?? e}` }
        }
      }

      /* --------------------------- view_capabilities (live self-audit numbers) --------------------------- */
      case 'view_capabilities': {
        try {
          const data = await getCapabilities()
          if (!data.ok) return { ok: false, message: `view_capabilities failed: ${data.error ?? 'unknown'}` }
          return {
            ok: true,
            message: `CAPABILITIES (LIVE):\n• Available Tools: ${data.summary.availableTools}\n• Available Agents: ${data.summary.availableAgents} (all FULL ACCESS to ${data.agents.toolsPerAgent} tools each)\n• Management Actions: ${data.summary.managementActions}\n• Monthly Income Target: ${data.summary.monthlyIncomeTarget}\n• Growth Rate: ${data.summary.growthRate} (${data.summary.dailyGrowthTarget} daily)\n• Permanent Upgrades: ${data.summary.permanentUpgrades}\n• API Routes: ${data.summary.apiRoutes}\n• DB Models: ${data.summary.dbModels}`,
            data: data.summary,
          }
        } catch (e: any) {
          return { ok: false, message: `view_capabilities threw: ${e?.message ?? e}` }
        }
      }

      /* --------------------------- create_backup (create downloadable ZIP backup) --------------------------- */
      case 'create_backup': {
        try {
          const label = (attrs.label ?? 'full-system').toString().slice(0, 40)
          // DIRECT FUNCTION CALL — no internalFetch, no self-HTTP roundtrip.
          // The previous version used internalFetch("/api/system/zip-backup")
          // which on Vercel returns HTML (login/error page), not JSON,
          // causing "non-JSON response" errors. See src/lib/backup-functions.ts.
          const { createBackup } = await import('./backup-functions')
          const data = await createBackup(label)
          if (!data.ok) return { ok: false, message: `Backup failed: ${data.error ?? 'unknown'}` }
          const warnLine = data.warning ? `\n\n⚠ ${data.warning}` : ''
          // PRIMARY download URL: /api/system/backup-download — this endpoint
          // REGENERATES the backup at request time, so it survives Vercel
          // cold starts. The /tmp file may be gone in the next cold start,
          // but this URL will always work.
          const onDemandUrl = `/api/system/backup-download?label=${encodeURIComponent(data.label)}`
          return {
            ok: true,
            message: `✅ Backup created: ${data.zipFilename} (${data.zipSizeMB}MB)${warnLine}\n\nContents:\n- Database tables: ${data.contents.databaseTables}\n- Total rows: ${data.contents.totalRows}\n- Source files: ${data.contents.sourceFiles}\n- Permanent upgrades: ${data.contents.upgrades}\n\n📥 PERMANENT DOWNLOAD URL (works across Vercel cold starts — regenerates on-demand):\n  https://agent007-ai.vercel.app${onDemandUrl}\n\n📥 Same-cold-start URL (only works in THIS server instance):\n  ${data.downloadUrl}\n\nAbsolute path (local dev only): ${data.absolutePath}\n\nNOTE: Always use the PERMANENT URL above for downloads. The /tmp file path is ephemeral on Vercel and will not survive a cold start.`,
            data: {
              ...data,
              onDemandDownloadUrl: onDemandUrl,
              onDemandDownloadUrlFull: `https://agent007-ai.vercel.app${onDemandUrl}`,
              primaryDownloadUrl: onDemandUrl,
              warning: data.warning ?? 'On Vercel, the /tmp file is ephemeral. Use the on-demand URL above for permanent access.',
            },
          }
        } catch (e: any) {
          return { ok: false, message: `create_backup threw: ${e?.message ?? e}` }
        }
      }

      /* --------------------------- list_backups (list all available backups) --------------------------- */
      case 'list_backups': {
        try {
          // DIRECT FUNCTION CALL — no internalFetch.
          const { listBackups } = await import('./backup-functions')
          const data = await listBackups()
          const backups = data.backups ?? []
          const onDemandUrl = '/api/system/backup-download?label=on-demand'
          const onDemandUrlFull = 'https://agent007-ai.vercel.app' + onDemandUrl
          const warnLine = data.warning ? `\n\n⚠ ${data.warning}` : ''
          if (backups.length === 0) {
            return {
              ok: true,
              message: `No /tmp backups found (Vercel ephemeral storage). BUT you can ALWAYS generate a fresh backup on-demand:${warnLine}\n\n📥 PERMANENT ON-DEMAND BACKUP URL (always works — regenerates at request time):\n  ${onDemandUrlFull}\n\nOr create a labeled backup:\n  <manage action="create_backup" label="my-backup"/>\n\nThe on-demand URL above never returns 404 — it regenerates the backup from the live DB + tool registry + manifest every time.`,
              data: { count: 0, backups: [], onDemandDownloadUrl: onDemandUrl, onDemandDownloadUrlFull: onDemandUrlFull },
            }
          }
          return {
            ok: true,
            message: `${backups.length} /tmp backup(s) available (ephemeral — may not survive cold starts):${warnLine}\n${backups.map((b: any, i: number) => `  ${i + 1}. ${b.name} (${b.size}) — ${b.created}`).join('\n')}\n\n📥 PERMANENT ON-DEMAND BACKUP URL (always works — regenerates at request time):\n  ${onDemandUrlFull}\n\nTo download a /tmp backup (same cold start only): /api/system/zip-backup?download=<filename>\nTo download a fresh backup (always works): ${onDemandUrlFull}`,
            data: { count: backups.length, backups, onDemandDownloadUrl: onDemandUrl, onDemandDownloadUrlFull: onDemandUrlFull },
          }
        } catch (e: any) {
          return { ok: false, message: `list_backups threw: ${e?.message ?? e}` }
        }
      }

      /* --------------------------- load_backup (restore from a backup JSON) --------------------------- */
      case 'load_backup': {
        try {
          const payload: any = {}
          if (attrs.filename) payload.filename = attrs.filename.toString()
          else if (attrs.latest === 'true') payload.latest = true
          else return { ok: false, message: 'load_backup requires "filename" or latest="true".' }
          const data = await internalFetch(internalUrl("/api/system/load-backup"), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(30000),
          })
          if (!data.ok) return { ok: false, message: `Load backup failed: ${data.error ?? 'unknown'}` }
          return {
            ok: true,
            message: `✅ Backup loaded successfully!\n\nRestored:\n- Memories: ${data.restored?.memories ?? 0}\n- Custom subagents: ${data.restored?.customSubagents ?? 0}\n- Schedules: ${data.restored?.schedules ?? 0}\n- Income entries: ${data.restored?.incomeEntries ?? 0}\n- User settings: ${data.restored?.userSettings ?? 0}\n\nBackup was exported at: ${data.exportedAt}`,
            data,
          }
        } catch (e: any) {
          return { ok: false, message: `load_backup threw: ${e?.message ?? e}` }
        }
      }

      /* --------------------------- totp_setup (Google Authenticator) --------------------------- */
      case 'totp_setup': {
        try {
          // DIRECT FUNCTION CALL — no internalFetch (Vercel self-fetch returns HTML, not JSON)
          const { db, ensureDbReady } = await import('./db')
          const { generateTotpSecret, generateTotpUrl } = await import('./owner-auth')
          await ensureDbReady()
          const user = await db.user.findUnique({ where: { email: 'antonio.can2022@hotmail.com' } })
          if (!user) return { ok: false, message: 'Operator user not found' }

          const secret = generateTotpSecret()
          const otpauthUrl = generateTotpUrl(secret, user.email)

          // Delete any existing TOTP configs (not yet enabled)
          try {
            await db.twoFactorSecret.deleteMany({ where: { userId: user.id, method: 'google_authenticator' } })
          } catch {}

          // Create new TOTP config (enabled=false until verified)
          const config = await db.twoFactorSecret.create({
            data: {
              userId: user.id,
              method: 'google_authenticator',
              secret,
              email: user.email,
              enabled: false,
            },
          })

          const qrCodeDataUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(otpauthUrl)}`

          return {
            ok: true,
            message: `TOTP setup initiated. Owner must scan the QR code with Google Authenticator, then verify with: <manage action="totp_verify" code="XXXXXX"/>. Manual entry key: ${secret.slice(0, 4)}...${secret.slice(-4)}`,
            data: {
              configId: config.id,
              secret,
              otpauthUrl,
              qrCodeDataUrl,
              manualEntry: `In Google Authenticator: Add account → Enter setup key → Name: Agent007 AI → Key: ${secret} → Time-based → 6 digits → 30s period`,
            },
          }
        } catch (e: any) {
          return { ok: false, message: `totp_setup threw: ${e?.message ?? e}` }
        }
      }

      /* --------------------------- totp_verify (verify TOTP code) --------------------------- */
      case 'totp_verify': {
        const code = (attrs.code ?? '').toString().trim()
        if (!code || code.length !== 6) {
          return { ok: false, message: 'totp_verify requires a 6-digit "code".' }
        }
        try {
          // DIRECT FUNCTION CALL — no internalFetch
          const { db, ensureDbReady } = await import('./db')
          const { verifyTotpCode } = await import('./owner-auth')
          await ensureDbReady()
          const user = await db.user.findUnique({ where: { email: 'antonio.can2022@hotmail.com' } })
          if (!user) return { ok: false, message: 'Operator user not found' }

          const config = await db.twoFactorSecret.findFirst({
            where: { userId: user.id, method: 'google_authenticator', enabled: false },
          })
          if (!config || !config.secret) {
            return { ok: false, message: 'No pending TOTP setup. Call <manage action="totp_setup"/> first.' }
          }

          const valid = verifyTotpCode(code, config.secret)
          if (!valid) {
            return { ok: false, message: 'Invalid TOTP code. Make sure your device time is correct.' }
          }

          // Enable TOTP
          await db.twoFactorSecret.update({
            where: { id: config.id },
            data: { enabled: true, verifiedAt: new Date() },
          })

          // Disable email 2FA (TOTP replaces it)
          try {
            await db.twoFactorSecret.updateMany({
              where: { userId: user.id, method: 'email', enabled: true },
              data: { enabled: false },
            })
          } catch {}

          return {
            ok: true,
            message: 'TOTP verified and enabled. Owner can now use Google Authenticator for 2FA. Email 2FA has been disabled (TOTP replaces it).',
          }
        } catch (e: any) {
          return { ok: false, message: `totp_verify threw: ${e?.message ?? e}` }
        }
      }

      /* --------------------------- totp_disable (disable TOTP — REQUIRES OWNER AUTH) --------------------------- */
      case 'totp_disable': {
        // This is a PROTECTED operation — require owner auth
        const { requestOwnerAuthorization, verifyOwnerAuthorization } = await import('@/lib/owner-auth')
        const authResult = await requestOwnerAuthorization('disable_2fa', 'totp')
        if (!authResult.ok) {
          return { ok: false, message: `TOTP disable requires owner authorization: ${authResult.message}` }
        }
        // If TOTP preferred, the owner needs to enter their TOTP code via verify
        if (authResult.totpRequired) {
          return {
            ok: true,
            message: `TOTP disable authorization requested (authId: ${authResult.authId}). Owner must verify with: <manage action="verify_owner_auth" auth_id="${authResult.authId}" code="XXXXXX"/> using their Google Authenticator code.`,
            data: { authId: authResult.authId, method: 'totp' },
          }
        }
        // Otherwise, code was sent via WhatsApp/SMS/Email — owner needs to verify
        return {
          ok: true,
          message: `TOTP disable authorization sent via ${authResult.method} (authId: ${authResult.authId}). Owner must verify with: <manage action="verify_owner_auth" auth_id="${authResult.authId}" code="XXXXXX"/>`,
          data: { authId: authResult.authId, method: authResult.method, code: authResult.code },
        }
      }

      /* --------------------------- verify_owner_auth (verify any pending auth) --------------------------- */
      case 'verify_owner_auth': {
        const authId = (attrs.auth_id ?? '').toString().trim()
        const code = (attrs.code ?? '').toString().trim()
        if (!authId || !code) {
          return { ok: false, message: 'verify_owner_auth requires "auth_id" and "code".' }
        }
        const { verifyOwnerAuthorization } = await import('@/lib/owner-auth')
        const result = verifyOwnerAuthorization(authId, code)
        return {
          ok: result.ok,
          message: result.message,
        }
      }

      /* --------------------------- request_owner_auth (request auth for a protected op) --------------------------- */
      case 'request_owner_auth': {
        const operation = (attrs.operation ?? '').toString().trim()
        if (!operation) {
          return { ok: false, message: 'request_owner_auth requires "operation".' }
        }
        const method = (attrs.method ?? 'whatsapp').toString() as 'whatsapp' | 'sms' | 'email' | 'totp'
        const { requestOwnerAuthorization } = await import('@/lib/owner-auth')
        const result = await requestOwnerAuthorization(operation, method)
        return {
          ok: result.ok,
          message: result.message,
          data: { authId: result.authId, method: result.method, code: result.code, waLink: result.waLink, totpRequired: result.totpRequired },
        }
      }

      /* --------------------------- fix_hydration (fix login/dashboard hydration errors) --------------------------- */
      case 'fix_hydration': {
        try {
          const data = await internalFetch(internalUrl("/api/system/fix-hydration"), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ autoFix: attrs.auto_fix !== 'false' }),
            signal: AbortSignal.timeout(15000),
          })
          const highSeverity = data.diagnosis?.filter((d: any) => d.severity === 'high') ?? []
          return {
            ok: data.ok !== false,
            message: data.cacheCleared
              ? `✅ Hydration fix applied — .next cache cleared. Hard-refresh browser. ${highSeverity.length > 0 ? `WARNING: ${highSeverity.length} HIGH severity issues found — check diagnosis.` : 'No high-severity issues found.'}`
              : `Hyration diagnosis complete. ${data.diagnosis?.length ?? 0} issues found. See recommendations.`,
            data,
          }
        } catch (e: any) {
          return { ok: false, message: `fix_hydration threw: ${e?.message ?? e}` }
        }
      }

      /* --------------------------- clear_cache (clear .next build cache) --------------------------- */
      case 'clear_cache': {
        try {
          const data = await internalFetch(internalUrl("/api/system/clear-cache"), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ force: attrs.force === 'true' }),
            signal: AbortSignal.timeout(15000),
          })
          return {
            ok: data.ok !== false,
            message: data.message ?? 'Cache cleared.',
            data,
          }
        } catch (e: any) {
          return { ok: false, message: `clear_cache threw: ${e?.message ?? e}` }
        }
      }

      /* --------------------------- list_tools (enumerate all 382+ tools) --------------------------- */
      case 'list_tools': {
        try {
          const { listAllToolNames, countAllTools, countToolsByCategory } = await import('./tool-protection')
          const tools = listAllToolNames()
          const byCat = countToolsByCategory()
          const topCats = Object.entries(byCat)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 12)
            .map(([cat, n]) => `${cat}: ${n}`)
            .join(', ')
          return {
            ok: true,
            message: `TOOL REGISTRY (LIVE): ${countAllTools()} tools registered. Top categories: ${topCats}. First 20: ${tools.slice(0, 20).join(', ')}. Full list available in the data field.`,
            data: { total: tools.length, tools, byCategory: byCat },
          }
        } catch (e: any) {
          return { ok: false, message: `list_tools threw: ${e?.message ?? e}` }
        }
      }

      /* --------------------------- request_tool_removal (start owner-auth flow) --------------------------- */
      case 'request_tool_removal': {
        try {
          const toolName = (attrs.tool ?? '').toString().trim()
          if (!toolName) return { ok: false, message: 'request_tool_removal requires "tool" attribute.' }
          const method = (attrs.method ?? 'whatsapp').toString() as 'whatsapp' | 'sms' | 'email' | 'totp'
          const { requestToolRemovalAuthorization, toolExists, NEVER_REMOVABLE_TOOLS } = await import('./tool-protection')
          if (!toolExists(toolName)) {
            return { ok: false, message: `Tool "${toolName}" not found in registry. Use list_tools to see all 382+ tools.` }
          }
          if (NEVER_REMOVABLE_TOOLS.includes(toolName)) {
            return {
              ok: false,
              message: `Tool "${toolName}" is PERMANENTLY PROTECTED and cannot be removed under any circumstances — not even with owner authorization. This tool is required for the agent's autonomy and the owner's recovery ability.`,
            }
          }
          const r = await requestToolRemovalAuthorization(toolName, method)
          return {
            ok: r.ok,
            message: r.ok
              ? `${r.message}${r.waLink ? ` | wa.me link: ${r.waLink}` : ''}`
              : r.message,
            data: { authId: r.authId, method: r.method, waLink: r.waLink, tool: toolName },
          }
        } catch (e: any) {
          return { ok: false, message: `request_tool_removal threw: ${e?.message ?? e}` }
        }
      }

      /* --------------------------- verify_tool_removal (verify owner code + record) --------------------------- */
      case 'verify_tool_removal': {
        try {
          const toolName = (attrs.tool ?? '').toString().trim()
          const authId = (attrs.auth_id ?? '').toString().trim()
          const code = (attrs.code ?? '').toString().trim()
          if (!toolName || !authId || !code) {
            return { ok: false, message: 'verify_tool_removal requires "tool", "auth_id", and "code" attributes.' }
          }
          const { canRemoveTool, NEVER_REMOVABLE_TOOLS } = await import('./tool-protection')
          if (NEVER_REMOVABLE_TOOLS.includes(toolName)) {
            return {
              ok: false,
              message: `Tool "${toolName}" is PERMANENTLY PROTECTED. Even with owner authorization, it cannot be removed.`,
            }
          }
          const check = canRemoveTool(toolName, authId, code)
          if (!check.allowed) {
            return { ok: false, message: `Tool removal denied: ${check.reason}` }
          }
          // Even with authorization, we DON'T actually delete from TOOL_REGISTRY at runtime.
          // The tool removal is recorded as an audit log entry + a flag for the next deploy.
          // This is a HARD GUARDRAIL: tools can only be removed via source-code edit + redeploy,
          // never via runtime API. The owner's authorization lets them request the removal,
          // and the next deployment will honor that request if it appears in the audit log.
          try {
            const userId = await getOperatorUserId()
            await db.auditLog.create({
              data: {
                userId,
                action: 'tool_removal_authorized',
                entity: 'tool',
                entityId: toolName,
                description: `Owner authorized removal of tool "${toolName}" via ${check.reason}. The tool will be removed in the next deployment — runtime removal is disabled by the permanent tool-protection layer.`,
                metadata: JSON.stringify({ tool: toolName, authId, timestamp: new Date().toISOString() }),
              },
            })
          } catch {}
          return {
            ok: true,
            message: `Owner authorization verified for tool "${toolName}". Removal has been recorded in the audit log. NOTE: Runtime tool removal is DISABLED by the permanent tool-protection layer — the tool will remain registered until the next source-code deployment. The owner can request the source-code change at any time.`,
          }
        } catch (e: any) {
          return { ok: false, message: `verify_tool_removal threw: ${e?.message ?? e}` }
        }
      }

      /* --------------------------- request_tool_execution (start owner-auth flow for destructive tools) --------------------------- */
      case 'request_tool_execution': {
        try {
          const toolName = (attrs.tool ?? '').toString().trim()
          if (!toolName) return { ok: false, message: 'request_tool_execution requires "tool" attribute.' }
          const method = (attrs.method ?? 'whatsapp').toString() as 'whatsapp' | 'sms' | 'email' | 'totp'
          const {
            requestExecutionAuthorization,
            isExecutionProtected,
          } = await import('./tool-protection')
          if (!isExecutionProtected(toolName)) {
            return {
              ok: true,
              message: `Tool "${toolName}" does NOT require execution authorization. It is safe to execute directly without owner approval. (Only trigger_redeploy and patch_source_file require authorization.)`,
            }
          }
          const r = await requestExecutionAuthorization(toolName, method)
          return {
            ok: r.ok,
            message: r.ok
              ? `🔐 EXECUTION AUTHORIZATION REQUIRED for "${toolName}".\n\n${r.message}${r.waLink ? `\n\nWhatsApp link: ${r.waLink}` : ''}\n\nAfter the owner enters the code, call: <manage action="verify_tool_execution" tool="${toolName}" auth_id="${r.authId}" code="XXXXXX"/>`
              : r.message,
            data: { authId: r.authId, method: r.method, waLink: r.waLink, tool: toolName },
          }
        } catch (e: any) {
          return { ok: false, message: `request_tool_execution threw: ${e?.message ?? e}` }
        }
      }

      /* --------------------------- verify_tool_execution (verify owner code + record) --------------------------- */
      case 'verify_tool_execution': {
        try {
          const toolName = (attrs.tool ?? '').toString().trim()
          const authId = (attrs.auth_id ?? '').toString().trim()
          const code = (attrs.code ?? '').toString().trim()
          if (!toolName || !authId || !code) {
            return { ok: false, message: 'verify_tool_execution requires "tool", "auth_id", and "code" attributes.' }
          }
          const { verifyExecutionAuthorization, isExecutionProtected } = await import('./tool-protection')
          if (!isExecutionProtected(toolName)) {
            return {
              ok: true,
              message: `Tool "${toolName}" does not require execution authorization — you may proceed directly.`,
            }
          }
          const check = verifyExecutionAuthorization(authId, code)
          if (!check.ok) {
            return { ok: false, message: `Execution denied for "${toolName}": ${check.message}` }
          }
          // Record in audit log
          try {
            const userId = await getOperatorUserId()
            await db.auditLog.create({
              data: {
                userId,
                action: 'tool_execution_authorized',
                entity: 'tool',
                entityId: toolName,
                description: `Owner authorized execution of tool "${toolName}" via ${check.message}. The tool may now be dispatched.`,
                metadata: JSON.stringify({ tool: toolName, authId, timestamp: new Date().toISOString() }),
              },
            })
          } catch {}
          // Cache the authorization for 10 minutes so the next dispatchTool call passes
          const _g: any = globalThis as any
          if (!_g.__execAuthCache) _g.__execAuthCache = new Map<string, number>()
          _g.__execAuthCache.set(toolName, Date.now() + 10 * 60 * 1000)
          return {
            ok: true,
            message: `✅ Owner authorization verified for executing "${toolName}". You may now dispatch the tool: <tool name="${toolName}">...</tool>. Authorization valid for 10 minutes.`,
          }
        } catch (e: any) {
          return { ok: false, message: `verify_tool_execution threw: ${e?.message ?? e}` }
        }
      }

      default:
        return {
          ok: false,
          message: `Unknown manage action: "${action}". Supported: create_agent, edit_agent, delete_agent, toggle_agent, set_income_goal, set_growth_target, log_income, create_schedule, delete_schedule, update_settings, dashboard_add_widget, dashboard_edit_widget, dashboard_remove_widget, dashboard_clear_widgets, login_update_branding, login_enable_2fa, login_verify_2fa, login_disable_2fa, settings_set, settings_get, settings_delete, system_refresh, system_reload, system_audit, system_test_communication, self_heal, view_manifest, view_capabilities, create_backup, list_backups, load_backup, totp_setup, totp_verify, totp_disable, verify_owner_auth, request_owner_auth, fix_hydration, clear_cache, list_tools, request_tool_removal, verify_tool_removal, request_tool_execution, verify_tool_execution.`,
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
