import { TOOL_REGISTRY } from '../src/lib/tools.ts'

const requested = ['website_builder', 'ui_form_builder', 'email_automation']

console.log('=== TOOL AUDIT ===')
console.log(`Total tools in registry: ${Object.keys(TOOL_REGISTRY).length}`)
console.log('')
console.log('REQUESTED TOOLS:')
for (const t of requested) {
  const exists = t in TOOL_REGISTRY
  console.log(`  ${exists ? '✅' : '❌'} ${t}${exists ? '' : ' — MISSING'}`)
}

console.log('')
console.log('SIMILAR TOOLS (for reference):')
const all = Object.keys(TOOL_REGISTRY)
for (const kw of ['website', 'form', 'email', 'automation', 'builder', 'ui_']) {
  const matches = all.filter((t) => t.includes(kw))
  if (matches.length > 0) {
    console.log(`  tools containing "${kw}" (${matches.length}):`)
    for (const t of matches.slice(0, 10)) {
      console.log(`    - ${t}`)
    }
    if (matches.length > 10) console.log(`    ... +${matches.length - 10} more`)
  }
}
