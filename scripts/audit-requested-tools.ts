import { TOOL_REGISTRY } from '../src/lib/tools.ts'
import { SUBAGENTS } from '../src/lib/subagents.ts'

const requested = [
  // Autonomy
  'decision_matrix', 'autonomous_decision_maker', 'self_improving_strategy',
  // Performance
  'performance_optimizer', 'feedback_optimization_loop', 'task_automation_expander',
  // Intelligence
  'advanced_trend_analyzer', 'repetitive_task_automator', 'self_optimization_engine',
  // Financial
  'quantum_revenue_optimizer', 'financial_tracker',
]

const subagents = ['scout', 'aurora', 'pulse', 'echo']

console.log('=== TOOL AUDIT ===')
console.log(`Total tools in registry: ${Object.keys(TOOL_REGISTRY).length}`)
console.log('')
console.log('REQUESTED TOOLS:')
for (const t of requested) {
  const exists = t in TOOL_REGISTRY
  console.log(`  ${exists ? '✅' : '❌'} ${t}${exists ? '' : ' — MISSING'}`)
}

console.log('')
console.log('SIMILAR TOOLS (for missing ones):')
const all = Object.keys(TOOL_REGISTRY)
for (const kw of ['quantum', 'revenue', 'financial']) {
  console.log(`  tools containing "${kw}":`)
  for (const t of all) {
    if (t.includes(kw)) console.log(`    - ${t}`)
  }
}

console.log('')
console.log('SUBAGENT STATUS:')
for (const s of subagents) {
  const found = SUBAGENTS.find((x: any) => x.id === s)
  console.log(`  ${found ? '✅' : '❌'} ${s}${found ? ` — name: ${found.name}, role: ${found.role}` : ' — MISSING'}`)
}
