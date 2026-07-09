import { dispatchTool, type ToolContext } from '../src/lib/tools'

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { console.log(`✅ ${label}`); pass++ }
  else { console.log(`❌ ${label}`); fail++ }
}
const ctx: ToolContext = { attachments: [], language: 'en' }

async function main() {
  // 1. predictive_intelligence
  console.log('\n--- 1. predictive_intelligence ---')
  const pi = await dispatchTool('predictive_intelligence', { domain: 'market', query: 'crypto market disruptions', horizon_days: 30, confidence_target: 95 }, ctx)
  assert(pi.ok === true, 'predictive_intelligence succeeds')
  assert(pi.result.includes('PREDICT'), 'has prediction section')

  // 2. emotional_intelligence
  console.log('\n--- 2. emotional_intelligence ---')
  const ei = await dispatchTool('emotional_intelligence', { text: 'I am so frustrated with this slow progress, I want to give up', context: 'weekly review', audience: 'the owner' }, ctx)
  assert(ei.ok === true, 'emotional_intelligence succeeds')
  assert(ei.result.includes('Layer') || ei.result.includes('LAYER'), 'has layer analysis')

  // 3. platform_ecosystem
  console.log('\n--- 3. platform_ecosystem ---')
  const pe = await dispatchTool('platform_ecosystem', { action: 'list_all' }, ctx)
  assert(pe.ok === true, 'platform_ecosystem list succeeds')
  assert(pe.result.includes('Shopify'), 'lists Shopify')
  assert(pe.result.includes('YouTube'), 'lists YouTube')
  assert(pe.result.includes('Coinbase'), 'lists Coinbase')
  assert(pe.result.includes('50+') || pe.result.includes('52'), 'shows 50+ platforms')

  // 4. security_compliance
  console.log('\n--- 4. security_compliance ---')
  const sc = await dispatchTool('security_compliance', { scan_type: 'full', target: 'full system' }, ctx)
  assert(sc.ok === true, 'security_compliance succeeds')
  assert(sc.result.includes('RISK REDUCTION'), 'has risk reduction metric')
  assert(sc.result.includes('SQL Injection'), 'checks SQL injection')
  assert(sc.result.includes('GDPR'), 'includes GDPR compliance')

  // 5. quantum_optimization
  console.log('\n--- 5. quantum_optimization ---')
  const qo = await dispatchTool('quantum_optimization', { problem: 'portfolio allocation', variables: 'stocks,bonds,crypto,cash', constraints: 'max_risk=0.3', num_qubits: 8, depth: 4, shots: 200 }, ctx)
  assert(qo.ok === true, 'quantum_optimization succeeds')
  assert(qo.result.includes('OPTIMAL SOLUTION'), 'has optimal solution')
  assert(qo.result.includes('Quantum advantage'), 'has quantum advantage metric')

  // 6. contract_negotiation
  console.log('\n--- 6. contract_negotiation ---')
  const cn = await dispatchTool('contract_negotiation', { action: 'analyze', contract_text: 'This partnership agreement states that Party A receives 30% revenue share and Party B receives 70%. The term is 24 months. IP remains with Party B. Either party may terminate with 30 days notice.', contract_type: 'partnership', counterparty: 'Acme Corp', our_position: 'We want 50% revenue share and shared IP' }, ctx)
  assert(cn.ok === true, 'contract_negotiation succeeds')
  assert(cn.result.includes('NEGOTIATION') || cn.result.includes('negotiation'), 'has negotiation strategy')

  // 7. personalization_engine
  console.log('\n--- 7. personalization_engine ---')
  const pe2 = await dispatchTool('personalization_engine', { strategy: 'crypto staking portfolio', user_input: 'I want low-risk passive income', goal: '$100/day' }, ctx)
  assert(pe2.ok === true, 'personalization_engine succeeds')
  assert(pe2.result.includes('PERSONALIZED') || pe2.result.includes('personalized'), 'has personalization section')

  // 8. global_compliance
  console.log('\n--- 8. global_compliance ---')
  const gc = await dispatchTool('global_compliance', { country: 'all', regulation: 'all', business_type: 'online_business' }, ctx)
  assert(gc.ok === true, 'global_compliance succeeds')
  assert(gc.result.includes('US'), 'checks US')
  assert(gc.result.includes('EU'), 'checks EU')
  assert(gc.result.includes('GDPR'), 'includes GDPR')

  // 9. predictive_maintenance
  console.log('\n--- 9. predictive_maintenance ---')
  const pm = await dispatchTool('predictive_maintenance', { component: 'all', horizon_days: 14 }, ctx)
  assert(pm.ok === true, 'predictive_maintenance succeeds')
  assert(pm.result.includes('Dev Server'), 'checks dev server')
  assert(pm.result.includes('MTBF'), 'has MTBF metric')
  assert(pm.result.includes('Downtime reduction'), 'has downtime reduction metric')

  // 10. neural_optimization
  console.log('\n--- 10. neural_optimization ---')
  const no = await dispatchTool('neural_optimization', { domain: 'income_prediction', target_metric: 'accuracy', current_accuracy: 0.87, iterations: 30 }, ctx)
  assert(no.ok === true, 'neural_optimization succeeds')
  assert(no.result.includes('OPTIMAL NEURAL ARCHITECTURE') || no.result.includes('architecture'), 'has architecture result')
  assert(no.result.includes('accuracy'), 'has accuracy metric')
  assert(no.result.includes('Improvement'), 'has improvement metric')

  console.log(`\n${'='.repeat(60)}\nRESULT: ${pass} passed, ${fail} failed\n${'='.repeat(60)}`)
  if (fail > 0) process.exit(1)
}
main().catch(e => { console.error('Crashed:', e); process.exit(1) })
