import { dispatchTool, type ToolContext } from '../src/lib/tools'
import { executeManageAction } from '../src/lib/orchestrator'

let pass = 0, fail = 0
function assert(cond: boolean, label: string) { if (cond) { console.log(`✅ ${label}`); pass++ } else { console.log(`❌ ${label}`); fail++ } }
const ctx: ToolContext = { attachments: [], language: 'en' }

async function main() {
  // === 1. Mission Tracker ===
  console.log('\n--- 1. mission_tracker ---')
  const mt = await dispatchTool('mission_tracker', { action: 'assess' }, ctx)
  assert(mt.ok === true, 'mission_tracker succeeds')
  assert(mt.result.includes('MISSION FEASIBILITY'), 'has feasibility assessment')
  assert(mt.result.includes('Success Probability'), 'has success probability')
  assert(mt.result.includes('3-PHASE STRATEGIC PLAN'), 'has 3-phase plan')
  assert(mt.result.includes('Phase 1'), 'has Phase 1')
  assert(mt.result.includes('Phase 2'), 'has Phase 2')
  assert(mt.result.includes('Phase 3'), 'has Phase 3')

  // === 2. Business Infrastructure ===
  console.log('\n--- 2. business_infrastructure ---')
  const bi = await dispatchTool('business_infrastructure', { action: 'status' }, ctx)
  assert(bi.ok === true, 'business_infrastructure succeeds')
  assert(bi.result.includes('INFRASTRUCTURE READINESS'), 'has readiness check')

  // === 3. Service Delivery ===
  console.log('\n--- 3. service_delivery ---')
  const sd = await dispatchTool('service_delivery', { action: 'list' }, ctx)
  assert(sd.ok === true, 'service_delivery succeeds')
  assert(sd.result.includes('TEMPLATES'), 'has service templates')
  assert(sd.result.includes('AI Content Creation'), 'has content creation template')

  // === 4. Financial Controls ===
  console.log('\n--- 4. financial_controls ---')
  const fc = await dispatchTool('financial_controls', { timeframe_days: 30 }, ctx)
  assert(fc.ok === true, 'financial_controls succeeds')
  assert(fc.result.includes('REVENUE METRICS'), 'has revenue metrics')
  assert(fc.result.includes('Cash Flow'), 'has cash flow projection')

  // === 5. CRM ===
  console.log('\n--- 5. crm ---')
  const crm = await dispatchTool('crm', { action: 'list' }, ctx)
  assert(crm.ok === true, 'crm succeeds')
  assert(crm.result.includes('Customer Management'), 'has CRM header')

  // === 6. Marketing Automation ===
  console.log('\n--- 6. marketing_automation ---')
  const ma = await dispatchTool('marketing_automation', { action: 'list' }, ctx)
  assert(ma.ok === true, 'marketing_automation succeeds')

  // === 7. Partnership Network ===
  console.log('\n--- 7. partnership_network ---')
  const pn = await dispatchTool('partnership_network', { action: 'list' }, ctx)
  assert(pn.ok === true, 'partnership_network succeeds')

  // === 8. Scalable Infrastructure ===
  console.log('\n--- 8. scalable_infrastructure ---')
  const si = await dispatchTool('scalable_infrastructure', { current_load: 10, target_load: 1000 }, ctx)
  assert(si.ok === true, 'scalable_infrastructure succeeds')
  assert(si.result.includes('Phase 1'), 'has Phase 1')
  assert(si.result.includes('Phase 3'), 'has Phase 3')

  // === 9. Manage actions — create customer ===
  console.log('\n--- 9. create_customer manage action ---')
  const cc = await executeManageAction('create_customer', { name: 'Test Customer', email: 'test@example.com', status: 'lead', source: 'outreach' })
  assert(cc.ok === true, 'create_customer succeeds')
  const customerId = cc.data?.id

  // === 10. create_campaign ===
  const cac = await executeManageAction('create_campaign', { name: 'Test Campaign', channel: 'cold_outreach', budget: '500', status: 'active' })
  assert(cac.ok === true, 'create_campaign succeeds')

  // === 11. create_partnership ===
  const cap = await executeManageAction('create_partnership', { partner_name: 'Test Partner', partner_type: 'referral', commission_rate: '15' })
  assert(cap.ok === true, 'create_partnership succeeds')

  // === 12. create_service_package ===
  const csp = await executeManageAction('create_service_package', { name: 'Test Package', category: 'content_creation', price_monthly: '500', description: 'Test service' })
  assert(csp.ok === true, 'create_service_package succeeds')

  // === 13. create_strategy ===
  const cst = await executeManageAction('create_strategy', { phase: 'phase1_foundation', title: 'AI Content Agency', description: 'Build content creation agency', priority: 'critical' })
  assert(cst.ok === true, 'create_strategy succeeds')

  // === 14. CRM now shows customer ===
  console.log('\n--- 14. CRM shows new customer ---')
  const crm2 = await dispatchTool('crm', { action: 'list' }, ctx)
  assert(crm2.result.includes('Test Customer'), 'CRM shows the new customer')

  // === 15. Mission tracker now shows improvements ===
  const mt2 = await dispatchTool('mission_tracker', { action: 'assess' }, ctx)
  assert(mt2.result.includes('5/5') || mt2.result.includes('Improvements Active:       5'), 'Mission tracker shows 5/5 improvements active')

  // === Cleanup ===
  if (customerId) await executeManageAction('delete_customer', { id: customerId })
  await executeManageAction('delete_campaign', { id: cac.data?.id })
  await executeManageAction('delete_partnership', { id: cap.data?.id })
  await executeManageAction('delete_service_package', { id: csp.data?.id })
  await executeManageAction('delete_strategy', { id: cst.data?.id })

  console.log(`\n${'='.repeat(60)}\nRESULT: ${pass} passed, ${fail} failed\n${'='.repeat(60)}`)
  if (fail > 0) process.exit(1)
}
main().catch(e => { console.error('Crashed:', e); process.exit(1) })
