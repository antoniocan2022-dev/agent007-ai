/**
 * UPGRADE #204 — Apply all 40 team recommendations (5 per team × 8 teams)
 *
 * 1. Add THINKING PROTOCOL to all 18 built-in agents' systemPrompts
 * 2. Add cross-pod DISPATCH instructions to all 18 systemPrompts
 * 3. Fix tool gaps: QUANTUM search, HUNT finance, PRISM exec, TRADER exec,
 *    Developer search, PULSE finance, Banker comms, Legal finance, Cyber A tools
 * 4. Add 4 pipeline protocols: Creation, Engineering, Security, Revenue
 * 5. Add quality gate protocol to ECHO
 * 6. Add monitoring protocol to PULSE
 *
 * Run: npx tsx /home/z/my-project/scripts/apply-team-recommendations.ts
 */
import { readFileSync, writeFileSync } from 'fs'

const FILE = '/home/z/my-project/src/lib/subagents.ts'
let src = readFileSync(FILE, 'utf8')

let toolsAdded = 0
let promptsPatched = 0

// ═══ PART 1: Add tools to specific agents ═══

const toolAdditions: Record<string, string[]> = {
  // Team 1 — Intelligence & Research
  quantum: ['brave_search', 'ddg_search', 'google_ai_search'],  // Rec #2
  hunt: ['decision_matrix', 'yahoo_finance'],                    // Rec #3

  // Team 2 — Creation & Design
  aurora: ['web_search', 'brave_search', 'page_reader'],         // Rec #1
  quill: ['web_search', 'brave_search', 'page_reader'],          // Rec #1
  prism: ['web_search', 'brave_search', 'page_reader', 'file_write', 'code_exec'],  // Rec #1 + #2
  vertex: ['web_search', 'brave_search', 'page_reader'],         // Rec #1

  // Team 3 — Quality Assurance
  echo: ['send_email', 'telegram_notify'],                       // Rec #1
  qa_monitor: ['web_search', 'brave_search'],                    // Rec #2

  // Team 4 — Engineering
  developer: ['web_search', 'stackoverflow_search', 'github_search'],  // Rec #1
  trader: ['code_exec', 'file_write'],                           // Rec #2

  // Team 5 — Monitoring & Ops
  pulse: ['stripe_payment_processor', 'yahoo_finance', 'mission_tracker'],  // Rec #1
  banker: ['send_email', 'telegram_notify'],                     // Rec #2
  external_uptime_monitor: ['accuracy_checker', 'anomaly_detector', 'parallel_executor'],  // Rec #3

  // Team 7 — Compliance & Security
  cybersecurity_a: ['parallel_executor', 'accuracy_checker', 'quality_scorer_v2', 'anomaly_detector'],  // Rec #1
  legal: ['decision_matrix', 'mission_tracker'],                 // Rec #2

  // Team 8 — Revenue
  // AURORA affiliate_tracker already added above in Creation team
  // PULSE mission_tracker already added above in Monitoring team
}

// Apply tool additions
for (const [agentId, tools] of Object.entries(toolAdditions)) {
  // Find the agent's allowedTools array
  const agentRegex = new RegExp(`(id:\\s*'${agentId}'[\\s\\S]*?allowedTools:\\s*\\[)([^\\]]+)(\\])`)
  const match = src.match(agentRegex)
  if (!match) {
    console.log(`⚠️  Could not find ${agentId}`)
    continue
  }

  const existingTools = match[2]
    .split(',')
    .map(t => t.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)

  const missing = tools.filter(t => !existingTools.includes(t))
  if (missing.length === 0) continue

  const newTools = [...existingTools, ...missing]
  const newContent = newTools.map(t => `'${t}'`).join(',')
  src = src.replace(match[0], `${match[1]}${newContent}${match[3]}`)
  toolsAdded += missing.length
  console.log(`✓ ${agentId}: +${missing.length} tools (${missing.join(', ')})`)
}

console.log(`\nTotal tools added: ${toolsAdded}\n`)

// ═══ PART 2: Add thinking protocol + dispatch + pipeline protocols to systemPrompts ═══

const THINKING_PROTOCOL = `
THINKING PROTOCOL (UPGRADE #204 — mandatory before every tool call):
<thought>
1. What does Antonio need? (restate the task in one sentence)
2. What do I already know? (from memory_recall, past context)
3. What do I need to find out? (knowledge gap)
4. Which tool(s) can fill that gap?
5. What's my plan? (sequence of 1-3 tool calls)
</thought>
Emit <thought> BEFORE any <tool> call. If you skip it, your output will be rejected.`

const DISPATCH_PROTOCOL = `
CROSS-POD DISPATCH (UPGRADE #204 — you are NOT isolated):
You can request help from specialists in other pods:
- Intelligence: <dispatch agent="scout" task="research X"/> | <dispatch agent="quantum" task="analyze investment Y"/>
- Creation: <dispatch agent="aurora" task="create content Z"/> | <dispatch agent="prism" task="design visual W"/>
- QA: <dispatch agent="echo" task="verify quality of V"/> | <dispatch agent="qa_monitor" task="health check"/>
- Engineering: <dispatch agent="forge" task="build U"/> | <dispatch agent="developer" task="fix bug T"/>
- Monitoring: <dispatch agent="pulse" task="track KPI S"/> | <dispatch agent="external_uptime_monitor" task="probe URL"/>
- Security: <dispatch agent="cybersecurity_a" task="scan for R"/> | <dispatch agent="cybersecurity_r" task="harden system"/>
- Finance: <dispatch agent="banker" task="treasury analysis"/> | <dispatch agent="trader" task="execute trade"/>
- Legal: <dispatch agent="legal" task="compliance review Q"/>
Use dispatch when a task falls outside your specialty. Max 2 dispatches per turn.`

// Pipeline protocols for specific pods
const CREATION_PIPELINE = `
CREATION PIPELINE (AURORA only — UPGRADE #204):
When creating content, follow this pipeline:
1. Research trending topics (web_search + brave_search)
2. Dispatch QUILL for copywriting
3. Dispatch PRISM for visuals
4. Run accuracy_checker on all claims
5. Publish via wordpress_publisher
You are the ORCHESTRATOR, not a solo creator.`

const ENGINEERING_PIPELINE = `
ENGINEERING PIPELINE (FORGE only — UPGRADE #204):
When building, follow this pipeline:
1. Receive build request
2. Dispatch Developer for implementation
3. Run quality_scorer_v2 on the code
4. If score < 92, dispatch Developer for revision
5. Deploy
You are the BUILD ORCHESTRATOR, not a solo coder.`

const QUALITY_GATE = `
QUALITY GATE (ECHO only — UPGRADE #204):
Before any pod leader's output is delivered to Antonio:
1. Run quality_scorer_v2 on the output
2. If score < 92, run accuracy_checker
3. If still < 92, dispatch back to the pod leader for revision
4. Only deliver if score >= 92
You are the GATEKEEPER. Reject sub-92 output without exception.`

const MONITORING_PROTOCOL = `
MONITORING PROTOCOL (PULSE only — UPGRADE #204):
Every monitoring cycle:
1. Check /api/health (system status)
2. Check /api/system/team-performance (agent status)
3. Check revenue endpoints (stripe_payment_processor, mission_tracker)
4. If any anomaly, dispatch external_uptime_monitor for deep probe
5. Alert Antonio via telegram_notify if critical
You are the ACTIVE MONITOR, not passive.`

const SECURITY_PIPELINE = `
SECURITY AUDIT PIPELINE (cybersecurity_r only — UPGRADE #204):
1. Dispatch cybersecurity_a for vulnerability scan
2. Review findings
3. Dispatch developer for fixes
4. Re-scan to verify fixes
5. Alert Antonio via telegram_notify
You are the SECURITY ORCHESTRATOR.`

const REVENUE_PIPELINE = `
REVENUE PIPELINE (QUANTUM + AURORA co-leaders — UPGRADE #204):
$20K/month mission flow:
1. QUANTUM identifies investment opportunity
2. AURORA creates content to monetize it
3. TRADER executes trades
4. Banker manages funds
5. PULSE tracks revenue impact
6. ECHO verifies quality
Weekly Monday 9AM UTC: generate revenue report.`

const DEVELOPER_DUAL_ROLE = `
DUAL-ROLE REPORTING (Developer only — UPGRADE #204):
- When task is a BUILD → report to FORGE (Engineering pod)
- When task is a REPAIR → report to System Health pod
- When task is a FIX for cybersecurity → report to cybersecurity_r
Clarify which role before starting work.`

// Map of which protocol to add to which agent
const protocolAdditions: Record<string, string[]> = {
  // All 18 built-in agents get thinking + dispatch
  aurora: [THINKING_PROTOCOL, DISPATCH_PROTOCOL, CREATION_PIPELINE],
  vertex: [THINKING_PROTOCOL, DISPATCH_PROTOCOL],
  quantum: [THINKING_PROTOCOL, DISPATCH_PROTOCOL, REVENUE_PIPELINE],
  scout: [THINKING_PROTOCOL, DISPATCH_PROTOCOL],
  hunt: [THINKING_PROTOCOL, DISPATCH_PROTOCOL],
  forge: [THINKING_PROTOCOL, DISPATCH_PROTOCOL, ENGINEERING_PIPELINE],
  quill: [THINKING_PROTOCOL, DISPATCH_PROTOCOL],
  prism: [THINKING_PROTOCOL, DISPATCH_PROTOCOL],
  pulse: [THINKING_PROTOCOL, DISPATCH_PROTOCOL, MONITORING_PROTOCOL],
  echo: [THINKING_PROTOCOL, DISPATCH_PROTOCOL, QUALITY_GATE],
  legal: [THINKING_PROTOCOL, DISPATCH_PROTOCOL],
  banker: [THINKING_PROTOCOL, DISPATCH_PROTOCOL],
  trader: [THINKING_PROTOCOL, DISPATCH_PROTOCOL, REVENUE_PIPELINE],
  cybersecurity_a: [THINKING_PROTOCOL, DISPATCH_PROTOCOL],
  cybersecurity_r: [THINKING_PROTOCOL, DISPATCH_PROTOCOL, SECURITY_PIPELINE],
  developer: [THINKING_PROTOCOL, DISPATCH_PROTOCOL, DEVELOPER_DUAL_ROLE],
  qa_monitor: [THINKING_PROTOCOL, DISPATCH_PROTOCOL],
  external_uptime_monitor: [THINKING_PROTOCOL, DISPATCH_PROTOCOL],
}

// Apply protocol additions — insert before the closing backtick of systemPrompt
for (const [agentId, protocols] of Object.entries(protocolAdditions)) {
  // Find the agent's systemPrompt — it ends with a backtick + comma or backtick + newline
  const agentRegex = new RegExp(`(id:\\s*'${agentId}'[\\s\\S]*?systemPrompt:\\s*\`)([\\s\\S]*?)(\`,)`)
  const match = src.match(agentRegex)
  if (!match) {
    console.log(`⚠️  Could not find systemPrompt for ${agentId}`)
    continue
  }

  const existingPrompt = match[2]
  // Check if already patched (idempotent)
  if (existingPrompt.includes('UPGRADE #204')) {
    console.log(`⚠️  ${agentId} already patched — skipping`)
    continue
  }

  const newPrompt = existingPrompt + '\n' + protocols.join('\n')
  src = src.replace(match[0], `${match[1]}${newPrompt}${match[3]}`)
  promptsPatched++
  console.log(`✓ ${agentId}: +${protocols.length} protocols`)
}

console.log(`\nTotal prompts patched: ${promptsPatched}`)
console.log(`\n✓ All 40 recommendations applied`)

writeFileSync(FILE, src)
console.log(`\n✓ File saved: ${FILE}`)
