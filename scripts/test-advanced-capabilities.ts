import { dispatchTool, type ToolContext } from '../src/lib/tools'

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { console.log(`✅ ${label}`); pass++ }
  else { console.log(`❌ ${label}`); fail++ }
}
const ctx: ToolContext = { attachments: [], language: 'en' }

async function main() {
  // 1. quantum_compute
  console.log('\n--- 1. quantum_compute ---')
  const qc = await dispatchTool('quantum_compute', { problem: 'portfolio optimization', variables: 'stocks,bonds,crypto,cash', num_qubits: 8, depth: 4, shots: 200 }, ctx)
  assert(qc.ok === true, 'quantum_compute succeeds')
  assert(qc.result.includes('OPTIMAL SOLUTION'), 'has optimal solution')
  assert(qc.result.includes('Quantum advantage'), 'has quantum advantage')

  // 2. consciousness_reflect
  console.log('\n--- 2. consciousness_reflect ---')
  const cr = await dispatchTool('consciousness_reflect', { question: 'What is my purpose?', mode: 'introspect', depth: 2 }, ctx)
  assert(cr.ok === true, 'consciousness_reflect succeeds')
  assert(cr.result.includes('Reflection') || cr.result.includes('reflection'), 'has reflection output')

  // 3. interstellar_market_scan
  console.log('\n--- 3. interstellar_market_scan ---')
  const im = await dispatchTool('interstellar_market_scan', { sector: 'all', timeframe_days: 30 }, ctx)
  assert(im.ok === true, 'interstellar_market_scan succeeds')
  assert(im.result.includes('OPPORTUNITIES') || im.result.includes('opportunities'), 'has opportunities section')

  // 4. empathy_analyze
  console.log('\n--- 4. empathy_analyze ---')
  const ea = await dispatchTool('empathy_analyze', { text: 'I am so frustrated with this slow progress', context: 'weekly review', audience: 'the owner' }, ctx)
  assert(ea.ok === true, 'empathy_analyze succeeds')
  assert(ea.result.includes('Layer') || ea.result.includes('LAYER'), 'has layer analysis')

  // 5. predictive_sentiment
  console.log('\n--- 5. predictive_sentiment ---')
  const ps = await dispatchTool('predictive_sentiment', { topic: 'Bitcoin', horizon_days: 7, markets: 'crypto' }, ctx)
  assert(ps.ok === true, 'predictive_sentiment succeeds')
  assert(ps.result.includes('TRAJECTORY') || ps.result.includes('trajectory'), 'has trajectory')

  // 6. legal_entity_create
  console.log('\n--- 6. legal_entity_create ---')
  const le = await dispatchTool('legal_entity_create', { country: 'US', jurisdiction: 'Delaware', entity_type: 'LLC', business_name: 'Quantum Holdings LLC', industry: 'investment', owner_name: 'Test Owner' }, ctx)
  assert(le.ok === true, 'legal_entity_create succeeds')
  assert(le.result.includes('Formation'), 'has formation package')

  // 7. predictive_health
  console.log('\n--- 7. predictive_health ---')
  const ph = await dispatchTool('predictive_health', { component: 'all', horizon_days: 14 }, ctx)
  assert(ph.ok === true, 'predictive_health succeeds')
  assert(ph.result.includes('Dev Server'), 'checks dev server')
  assert(ph.result.includes('INDEFINITE'), 'projects indefinite lifespan')

  // 8. neural_singular
  console.log('\n--- 8. neural_singular ---')
  const ns = await dispatchTool('neural_singular', { problem_domain: 'income_optimization', complexity_level: 6, iterations: 30 }, ctx)
  assert(ns.ok === true, 'neural_singular succeeds')
  assert(ns.result.includes('EMERGENT'), 'has emergent algorithm')
  assert(ns.result.includes('Singularity'), 'has singularity score')

  // 9. energy_optimize
  console.log('\n--- 9. energy_optimize ---')
  const eo = await dispatchTool('energy_optimize', { scope: 'global', target_reduction: 50, timeframe_days: 30, workload_kw: 50 }, ctx)
  assert(eo.ok === true, 'energy_optimize succeeds')
  assert(eo.result.includes('OPTIMAL WORKLOAD ALLOCATION'), 'has allocation table')
  assert(eo.result.includes('CARBON OFFSET'), 'has carbon offset plan')

  // 10. interdimensional_data
  console.log('\n--- 10. interdimensional_data ---')
  const id = await dispatchTool('interdimensional_data', { query: 'Bitcoin 2026 outlook', dimensions: 'time,probability,parallel', scenarios: 5 }, ctx)
  assert(id.ok === true, 'interdimensional_data succeeds')
  assert(id.result.includes('DIMENSION') || id.result.includes('dimension'), 'has dimension analysis')
  assert(id.result.includes('SYNTHESIS') || id.result.includes('synthesis'), 'has synthesis section')

  console.log(`\n${'='.repeat(60)}\nRESULT: ${pass} passed, ${fail} failed\n${'='.repeat(60)}`)
  if (fail > 0) process.exit(1)
}
main().catch(e => { console.error('Crashed:', e); process.exit(1) })
