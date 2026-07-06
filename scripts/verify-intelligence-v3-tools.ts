/**
 * verify-intelligence-v3-tools.ts
 * Dispatches each of the 5 new intelligence-v3 tools + reports pass/fail.
 */
import { dispatchTool, TOOL_REGISTRY } from '/home/z/my-project/src/lib/tools'
import { NEVER_REMOVABLE_TOOLS } from '/home/z/my-project/src/lib/tool-protection'

const ctx = { attachments: [], language: 'en' as const }

const tools = [
  { name: 'advanced_trend_analyzer', args: { domain: 'all', timeframe: '30d' } },
  { name: 'self_optimization_engine', args: { action: 'report' } },
  { name: 'strategy_feedback_integrator', args: { action: 'report' } },
  { name: 'repetitive_task_automator', args: { action: 'report' } },
  { name: 'subagent_coordinator', args: { action: 'report' } },
]

console.log('═══════════════════════════════════════════════════════════════')
console.log('  Agent007 — Upgrade #37 Intelligence V3 Tool Verification')
console.log('═══════════════════════════════════════════════════════════════')
console.log(`Total tools in registry: ${Object.keys(TOOL_REGISTRY).length}`)
console.log(`NEVER_REMOVABLE count: ${NEVER_REMOVABLE_TOOLS.length}`)
console.log()

let passCount = 0
let failCount = 0

for (const t of tools) {
  const exists = !!TOOL_REGISTRY[t.name]
  const isLocked = NEVER_REMOVABLE_TOOLS.includes(t.name)
  if (!exists) {
    console.log(`❌ ${t.name.padEnd(35)} NOT REGISTERED`)
    failCount++
    continue
  }
  if (!isLocked) {
    console.log(`⚠️  ${t.name.padEnd(35)} REGISTERED but NOT LOCKED`)
    failCount++
    continue
  }
  try {
    const result = await dispatchTool(t.name, t.args, ctx as any)
    if (result.ok) {
      const preview = result.preview.slice(0, 75)
      console.log(`✅ ${t.name.padEnd(35)} ${preview}`)
      passCount++
    } else {
      console.log(`❌ ${t.name.padEnd(35)} returned ok=false: ${result.result.slice(0, 100)}`)
      failCount++
    }
  } catch (e: any) {
    console.log(`❌ ${t.name.padEnd(35)} threw: ${e?.message ?? String(e)}`)
    failCount++
  }
}

console.log()
console.log('═══════════════════════════════════════════════════════════════')
console.log(`  RESULT: ${passCount}/${tools.length} passed, ${failCount} failed`)
console.log('═══════════════════════════════════════════════════════════════')

const totalTools = Object.keys(TOOL_REGISTRY).length
const expectedMin = 519
console.log()
console.log(`Total tools: ${totalTools} (expected ≥ ${expectedMin})`)
console.log(`Status: ${totalTools >= expectedMin ? '✅ PASS' : '❌ FAIL'}`)

const all5Registered = tools.every(t => !!TOOL_REGISTRY[t.name])
console.log(`All 5 new tools registered: ${all5Registered ? '✅ PASS' : '❌ FAIL'}`)

const all5Locked = tools.every(t => NEVER_REMOVABLE_TOOLS.includes(t.name))
console.log(`All 5 new tools NEVER_REMOVABLE: ${all5Locked ? '✅ PASS' : '❌ FAIL'}`)

process.exit(failCount === 0 && all5Registered && all5Locked ? 0 : 1)
