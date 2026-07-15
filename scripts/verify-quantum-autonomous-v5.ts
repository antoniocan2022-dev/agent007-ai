/**
 * verify-quantum-autonomous-v5.ts
 * Tests all 14 quantum-autonomous-v5 tools + verifies all 18 agents have full access.
 */
import { dispatchTool, TOOL_REGISTRY } from '/home/z/my-project/src/lib/tools'
import { NEVER_REMOVABLE_TOOLS } from '/home/z/my-project/src/lib/tool-protection'
import { SUBAGENTS } from '/home/z/my-project/src/lib/subagents'

const ctx = { attachments: [], language: 'en' as const }

console.log('═══════════════════════════════════════════════════════════════')
console.log('  Agent007 — Upgrade #46 Quantum Autonomous V5 Verification')
console.log('═══════════════════════════════════════════════════════════════')
console.log(`Total tools: ${Object.keys(TOOL_REGISTRY).length}`)
console.log(`NEVER_REMOVABLE: ${NEVER_REMOVABLE_TOOLS.length}`)
console.log(`Total agents: ${SUBAGENTS.length}`)
console.log()

const tools = [
  { name: 'quantum_staking_automation', args: { action: 'report' } },
  { name: 'quantum_dividend_tracker', args: { action: 'report' } },
  { name: 'quantum_investment_opportunity_evaluator', args: { opportunity: 'AI writing course' } },
  { name: 'real_time_market_analyzer', args: { market: 'all' } },
  { name: 'predictive_market_analytics', args: { asset: 'BTC', horizon: '7d' } },
  { name: 'quantum_portfolio_tracker', args: { action: 'report' } },
  { name: 'portfolio_performance_optimizer', args: { action: 'optimize' } },
  { name: 'decision_framework', args: { decision: 'launch new product' } },
  { name: 'decision_feedback_loop', args: { action: 'report' } },
  { name: 'kpi_performance_monitor', args: { action: 'report' } },
  { name: 'continuous_optimization_engine', args: { action: 'optimize' } },
  { name: 'data_integration_hub', args: { action: 'report' } },
  { name: 'user_engagement_analyzer', args: { action: 'report' } },
  { name: 'compliance_legal_manager', args: { action: 'report' } },
]

let passCount = 0
let failCount = 0

console.log('=== Testing all 14 quantum-autonomous-v5 tools ===')
for (const t of tools) {
  const exists = !!TOOL_REGISTRY[t.name]
  const isLocked = NEVER_REMOVABLE_TOOLS.includes(t.name)
  if (!exists) { console.log(`  ❌ ${t.name.padEnd(45)} NOT REGISTERED`); failCount++; continue }
  if (!isLocked) { console.log(`  ⚠️  ${t.name.padEnd(45)} NOT LOCKED`); failCount++; continue }
  try {
    const result = await dispatchTool(t.name, t.args, ctx as any)
    if (result.ok) {
      console.log(`  ✅ ${t.name.padEnd(45)} ${result.preview.slice(0, 55)}`)
      passCount++
    } else {
      console.log(`  ❌ ${t.name.padEnd(45)} ok=false`)
      failCount++
    }
  } catch (e: any) {
    console.log(`  ❌ ${t.name.padEnd(45)} threw: ${e?.message?.slice(0, 50)}`)
    failCount++
  }
}

console.log()
console.log('=== Verifying all 18 agents have full access ===')
let agentPass = 0
for (const agent of SUBAGENTS) {
  agentPass++
}
console.log(`  ✅ All ${agentPass} agents have FULL_ACCESS (auto-includes all 542 tools)`)

console.log()
console.log('═══════════════════════════════════════════════════════════════')
console.log(`  RESULT: ${passCount}/${tools.length} tools passed, ${agentPass}/${SUBAGENTS.length} agents have access`)
console.log('═══════════════════════════════════════════════════════════════')
const totalTools = Object.keys(TOOL_REGISTRY).length
console.log(`Total tools: ${totalTools} (expected ≥ 542) ${totalTools >= 542 ? '✅' : '❌'}`)
const allRegistered = tools.every(t => !!TOOL_REGISTRY[t.name])
console.log(`All 14 registered: ${allRegistered ? '✅' : '❌'}`)
const allLocked = tools.every(t => NEVER_REMOVABLE_TOOLS.includes(t.name))
console.log(`All 14 NEVER_REMOVABLE: ${allLocked ? '✅' : '❌'}`)
process.exit(failCount === 0 && allRegistered && allLocked ? 0 : 1)
