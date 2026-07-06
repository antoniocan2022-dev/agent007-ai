/**
 * verify-optimization-v2-tools.ts
 * Dispatches each of the 6 new optimization-v2 tools + reports pass/fail.
 */
import { dispatchTool, TOOL_REGISTRY } from '/home/z/my-project/src/lib/tools'
import { NEVER_REMOVABLE_TOOLS } from '/home/z/my-project/src/lib/tool-protection'

const ctx = { attachments: [], language: 'en' as const }

const tools = [
  { name: 'execution_time_optimizer', args: { action: 'analyze' } },
  { name: 'dependency_updater', args: { action: 'check' } },
  { name: 'tool_usage_tracker', args: { action: 'report' } },
  { name: 'training_session_organizer', args: { action: 'schedule' } },
  { name: 'accuracy_feedback_loop', args: { action: 'report' } },
  { name: 'tool_audit_scheduler', args: { action: 'report' } },
]

console.log('═══════════════════════════════════════════════════════════════')
console.log('  Agent007 — Upgrade #36 Optimization V2 Tool Verification')
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

// Also verify the registry now has 471+ tools (was 465 before this upgrade)
const totalTools = Object.keys(TOOL_REGISTRY).length
const expectedMin = 471
console.log()
console.log(`Total tools: ${totalTools} (expected ≥ ${expectedMin})`)
console.log(`Status: ${totalTools >= expectedMin ? '✅ PASS' : '❌ FAIL'}`)

// Verify all 6 new tools are in the registry
const all6Registered = tools.every(t => !!TOOL_REGISTRY[t.name])
console.log(`All 6 new tools registered: ${all6Registered ? '✅ PASS' : '❌ FAIL'}`)

// Verify all 6 new tools are NEVER_REMOVABLE
const all6Locked = tools.every(t => NEVER_REMOVABLE_TOOLS.includes(t.name))
console.log(`All 6 new tools NEVER_REMOVABLE: ${all6Locked ? '✅ PASS' : '❌ FAIL'}`)

process.exit(failCount === 0 && all6Registered && all6Locked ? 0 : 1)
