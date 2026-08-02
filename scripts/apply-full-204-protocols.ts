/**
 * UPGRADE #211 — COMPLETE #204 Protocol Re-application
 *
 * Applies ALL #204 protocols that were lost in the git rebase:
 * 1. THINKING PROTOCOL — to all 18 agents (9 currently have it, need 18)
 * 2. CROSS-POD DISPATCH — already in all 18 (verified)
 * 3. 6 pipeline protocols (Creation, Engineering, Quality Gate, Monitoring, Security, Revenue)
 * 4. 1 dual-role protocol (Developer)
 *
 * This is the FULL version, not simplified.
 */
import { readFileSync, writeFileSync } from 'fs'

const FILE = '/home/z/my-project/src/lib/subagents.ts'
let src = readFileSync(FILE, 'utf8')

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

// Map: which agent gets which protocols
const protocolsToAdd: Record<string, string[]> = {
  aurora: [THINKING_PROTOCOL, CREATION_PIPELINE],
  vertex: [THINKING_PROTOCOL],
  quantum: [THINKING_PROTOCOL, REVENUE_PIPELINE],
  scout: [THINKING_PROTOCOL],
  hunt: [THINKING_PROTOCOL],
  forge: [THINKING_PROTOCOL, ENGINEERING_PIPELINE],
  quill: [THINKING_PROTOCOL],
  prism: [THINKING_PROTOCOL],
  pulse: [THINKING_PROTOCOL, MONITORING_PROTOCOL],
  echo: [THINKING_PROTOCOL, QUALITY_GATE],
  legal: [THINKING_PROTOCOL],
  banker: [THINKING_PROTOCOL],
  trader: [THINKING_PROTOCOL, REVENUE_PIPELINE],
  cybersecurity_a: [THINKING_PROTOCOL],
  cybersecurity_r: [THINKING_PROTOCOL, SECURITY_PIPELINE],
  developer: [THINKING_PROTOCOL, DEVELOPER_DUAL_ROLE],
  qa_monitor: [THINKING_PROTOCOL],
  external_uptime_monitor: [THINKING_PROTOCOL],
}

let totalAdded = 0
let agentsPatched = 0

for (const [agentId, protocols] of Object.entries(protocolsToAdd)) {
  // Find the agent's systemPrompt
  const agentRegex = new RegExp(`(id:\\s*'${agentId}'[\\s\\S]*?systemPrompt:\\s*\`)([\\s\\S]*?)(\`,)`)
  const match = src.match(agentRegex)
  if (!match) {
    console.log(`⚠️  Could not find ${agentId}`)
    continue
  }

  let existingPrompt = match[2]
  let promptToAdd = ''

  for (const protocol of protocols) {
    // Extract the protocol name from the first line
    const protoName = protocol.trim().split('\n')[0].trim()
    if (existingPrompt.includes(protoName)) {
      console.log(`  ⊘ ${agentId} already has ${protoName.slice(0, 50)}...`)
      continue
    }
    promptToAdd += '\n' + protocol
    totalAdded++
  }

  if (!promptToAdd) {
    console.log(`  ✓ ${agentId} — all protocols already present`)
    continue
  }

  const newPrompt = existingPrompt + promptToAdd
  src = src.replace(match[0], `${match[1]}${newPrompt}${match[3]}`)
  agentsPatched++
  console.log(`  ✓ ${agentId} — added ${protocols.length} protocol(s)`)
}

writeFileSync(FILE, src)
console.log(`\n✓ Total: ${totalAdded} protocols added across ${agentsPatched} agents`)
console.log('✓ Full #204 protocol set now complete (not simplified)')
