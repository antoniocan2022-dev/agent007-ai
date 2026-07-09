/**
 * verify-advanced-tools.ts — sanity-check that all 10 advanced tools
 * are registered in TOOL_REGISTRY and that each function is callable.
 *
 * Run: npx tsx scripts/verify-advanced-tools.ts
 */
import { TOOL_REGISTRY } from '../src/lib/tools'

const expected = [
  'quantum_compute',
  'consciousness_reflect',
  'interstellar_market_scan',
  'empathy_analyze',
  'predictive_sentiment',
  'legal_entity_create',
  'predictive_health',
  'neural_singular',
  'energy_optimize',
  'interdimensional_data',
]

let pass = 0
let fail = 0
console.log('Verifying 10 advanced tools are registered...\n')
for (const name of expected) {
  const entry = TOOL_REGISTRY[name]
  if (!entry) {
    console.log(`❌ MISSING: ${name}`)
    fail++
    continue
  }
  if (typeof entry.fn !== 'function') {
    console.log(`❌ NOT A FUNCTION: ${name} (got ${typeof entry.fn})`)
    fail++
    continue
  }
  console.log(`✅ ${name.padEnd(28)} → ${entry.label} (icon: ${entry.icon})`)
  pass++
}

console.log(`\nResult: ${pass}/${expected.length} tools registered`)
if (fail > 0) {
  console.error(`❌ ${fail} tools missing or invalid`)
  process.exit(1)
}

// Also check total tool count
const total = Object.keys(TOOL_REGISTRY).length
console.log(`\nTotal tools registered: ${total}`)
console.log('\nAll checks passed ✅')
