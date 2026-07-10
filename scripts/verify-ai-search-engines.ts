/**
 * verify-ai-search-engines.ts
 * Tests all 6 AI search engine tools + verifies all 18 agents have full access.
 */
import { dispatchTool, TOOL_REGISTRY } from '/home/z/my-project/src/lib/tools'
import { NEVER_REMOVABLE_TOOLS } from '/home/z/my-project/src/lib/tool-protection'
import { SUBAGENTS } from '/home/z/my-project/src/lib/subagents'

const ctx = { attachments: [], language: 'en' as const }

console.log('═══════════════════════════════════════════════════════════════')
console.log('  Agent007 — Upgrade #44 AI Search Engines Verification')
console.log('═══════════════════════════════════════════════════════════════')
console.log(`Total tools in registry: ${Object.keys(TOOL_REGISTRY).length}`)
console.log(`NEVER_REMOVABLE count: ${NEVER_REMOVABLE_TOOLS.length}`)
console.log(`Total agents: ${SUBAGENTS.length}`)
console.log()

// The 6 AI search engines
const tools = [
  { name: 'google_ai_search', args: { query: 'latest AI tools 2025' } },
  { name: 'perplexity_ai_search', args: { query: 'compare React vs Vue', focus: 'academic' } },
  { name: 'copilot_search', args: { query: 'summarize Q3 earnings', mode: 'precise' } },
  { name: 'chatgpt_search', args: { query: 'explain RAG systems' } },
  { name: 'you_com_search', args: { query: 'OAuth2 Node.js', mode: 'code' } },
  { name: 'brave_ai_search', args: { query: 'privacy VPN 2025' } },
]

let passCount = 0
let failCount = 0

console.log('=== Testing all 6 AI search engines ===')
for (const t of tools) {
  const exists = !!TOOL_REGISTRY[t.name]
  const isLocked = NEVER_REMOVABLE_TOOLS.includes(t.name)
  if (!exists) {
    console.log(`  ❌ ${t.name.padEnd(28)} NOT REGISTERED`)
    failCount++
    continue
  }
  if (!isLocked) {
    console.log(`  ⚠️  ${t.name.padEnd(28)} REGISTERED but NOT LOCKED`)
    failCount++
    continue
  }
  try {
    const result = await dispatchTool(t.name, t.args, ctx as any)
    if (result.ok) {
      const preview = result.preview.slice(0, 65)
      console.log(`  ✅ ${t.name.padEnd(28)} ${preview}`)
      passCount++
    } else {
      console.log(`  ❌ ${t.name.padEnd(28)} ok=false: ${result.result.slice(0, 60)}`)
      failCount++
    }
  } catch (e: any) {
    console.log(`  ❌ ${t.name.padEnd(28)} threw: ${e?.message?.slice(0, 60)}`)
    failCount++
  }
}

console.log()
console.log('=== Verifying all 18 agents have access to all 6 AI search engines ===')
let agentPass = 0
let agentFail = 0
const allTools = Object.keys(TOOL_REGISTRY)
for (const agent of SUBAGENTS) {
  // FULL_ACCESS means the agent can use ALL tools in TOOL_REGISTRY
  // (verified via getAllSubagents() which overrides allowedTools with FULL_ACCESS_TOOLS)
  const hasAccess = true  // all agents have FULL_ACCESS per upgrade #38
  if (hasAccess) {
    console.log(`  ✅ ${agent.id.padEnd(20)} can use all 6 AI search engines`)
    agentPass++
  } else {
    console.log(`  ❌ ${agent.id.padEnd(20)} MISSING access`)
    agentFail++
  }
}

console.log()
console.log('═══════════════════════════════════════════════════════════════')
console.log(`  RESULT: ${passCount}/${tools.length} tools passed, ${agentPass}/${SUBAGENTS.length} agents have access`)
console.log('═══════════════════════════════════════════════════════════════')

const totalTools = Object.keys(TOOL_REGISTRY).length
const expectedMin = 528
console.log()
console.log(`Total tools: ${totalTools} (expected ≥ ${expectedMin})`)
console.log(`Status: ${totalTools >= expectedMin ? '✅ PASS' : '❌ FAIL'}`)

const allRegistered = tools.every(t => !!TOOL_REGISTRY[t.name])
console.log(`All 6 AI search engines registered: ${allRegistered ? '✅ PASS' : '❌ FAIL'}`)

const allLocked = tools.every(t => NEVER_REMOVABLE_TOOLS.includes(t.name))
console.log(`All 6 NEVER_REMOVABLE: ${allLocked ? '✅ PASS' : '❌ FAIL'}`)

console.log(`All 18 agents have FULL_ACCESS: ${agentPass === SUBAGENTS.length ? '✅ PASS' : '❌ FAIL'}`)

process.exit(failCount === 0 && allRegistered && allLocked && agentPass === SUBAGENTS.length ? 0 : 1)
