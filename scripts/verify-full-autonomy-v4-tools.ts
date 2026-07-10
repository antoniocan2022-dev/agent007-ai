/**
 * verify-full-autonomy-v4-tools.ts
 * Tests all 8 full-autonomy tools + the 2 new ones (decision_matrix + autonomy_policy_enforcer)
 */
import { dispatchTool, TOOL_REGISTRY } from '/home/z/my-project/src/lib/tools'
import { NEVER_REMOVABLE_TOOLS } from '/home/z/my-project/src/lib/tool-protection'

const ctx = { attachments: [], language: 'en' as const }

console.log('═══════════════════════════════════════════════════════════════')
console.log('  Agent007 — Upgrade #42 Full Autonomy V4 Tool Verification')
console.log('═══════════════════════════════════════════════════════════════')
console.log(`Total tools in registry: ${Object.keys(TOOL_REGISTRY).length}`)
console.log(`NEVER_REMOVABLE count: ${NEVER_REMOVABLE_TOOLS.length}`)
console.log()

// The 8 full-autonomy tools
const tools = [
  { name: 'autonomous_decision_maker', args: { decision: 'test decision', context: 'test' } },
  { name: 'self_improving_strategy', args: { action: 'report' } },
  { name: 'performance_optimizer', args: {} },
  { name: 'feedback_optimization_loop', args: { action: 'report' } },
  { name: 'task_automation_expander', args: { action: 'report' } },
  { name: 'workflow_orchestrator', args: { workflow: 'test' } },
  { name: 'decision_matrix', args: { decision: 'Choose niche', options: ['AI tools', 'Crypto', 'POD'], criteria: [{ name: 'revenue', weight: 0.4 }, { name: 'competition', weight: 0.3 }, { name: 'ease', weight: 0.3 }] } },
  { name: 'memory_store', args: { key: 'test_autonomy_v4', value: 'verification test', category: 'test' } },
  { name: 'autonomy_policy_enforcer', args: { action: 'check', decision_type: 'pricing_change', impact_score: 65, dollar_amount: 300 } },
]

let passCount = 0
let failCount = 0

console.log('=== Testing all 8 full-autonomy tools + autonomy_policy_enforcer ===')
for (const t of tools) {
  const exists = !!TOOL_REGISTRY[t.name]
  const isLocked = NEVER_REMOVABLE_TOOLS.includes(t.name)
  if (!exists) {
    console.log(`  ❌ ${t.name.padEnd(35)} NOT REGISTERED`)
    failCount++
    continue
  }
  if (!isLocked) {
    console.log(`  ⚠️  ${t.name.padEnd(35)} REGISTERED but NOT LOCKED`)
    failCount++
    continue
  }
  try {
    const result = await dispatchTool(t.name, t.args, ctx as any)
    if (result.ok) {
      const preview = result.preview.slice(0, 75)
      console.log(`  ✅ ${t.name.padEnd(35)} ${preview}`)
      passCount++
    } else {
      console.log(`  ❌ ${t.name.padEnd(35)} returned ok=false: ${result.result.slice(0, 80)}`)
      failCount++
    }
  } catch (e: any) {
    console.log(`  ❌ ${t.name.padEnd(35)} threw: ${e?.message?.slice(0, 80)}`)
    failCount++
  }
}

console.log()
console.log('═══════════════════════════════════════════════════════════════')
console.log(`  RESULT: ${passCount}/${tools.length} passed, ${failCount} failed`)
console.log('═══════════════════════════════════════════════════════════════')

const totalTools = Object.keys(TOOL_REGISTRY).length
const expectedMin = 522
console.log()
console.log(`Total tools: ${totalTools} (expected ≥ ${expectedMin})`)
console.log(`Status: ${totalTools >= expectedMin ? '✅ PASS' : '❌ FAIL'}`)

const allRegistered = tools.every(t => !!TOOL_REGISTRY[t.name])
console.log(`All tools registered: ${allRegistered ? '✅ PASS' : '❌ FAIL'}`)

const allLocked = tools.every(t => NEVER_REMOVABLE_TOOLS.includes(t.name))
console.log(`All tools NEVER_REMOVABLE: ${allLocked ? '✅ PASS' : '❌ FAIL'}`)

process.exit(failCount === 0 && allRegistered && allLocked ? 0 : 1)
