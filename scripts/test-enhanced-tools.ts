import { dispatchTool, type ToolContext } from '../src/lib/tools'

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { console.log(`✅ ${label}`); pass++ }
  else { console.log(`❌ ${label}`); fail++ }
}
const ctx: ToolContext = { attachments: [], language: 'en' }

async function main() {
  // 1. currency_international
  console.log('\n--- 1. currency_international ---')
  const c = await dispatchTool('currency_international', { from: 'USD', to: 'EUR', amount: 100, countries: 'US,CA,GB,SG' }, ctx)
  assert(c.ok === true, 'currency_international succeeds')
  assert(c.result.includes('EUR'), 'shows EUR conversion')
  assert(c.result.includes('IRS'), 'includes US tax authority')
  assert(c.result.includes('CRA'), 'includes CA tax authority')

  // 2. analytics_dashboard
  console.log('\n--- 2. analytics_dashboard ---')
  const a = await dispatchTool('analytics_dashboard', { timeframe_days: 30 }, ctx)
  assert(a.ok === true, 'analytics_dashboard succeeds')
  assert(a.result.includes('ANALYTICS DASHBOARD'), 'has dashboard title')
  assert(a.result.includes('REVENUE METRICS'), 'has revenue metrics')

  // 3. opportunity_auto_scan
  console.log('\n--- 3. opportunity_auto_scan ---')
  const o = await dispatchTool('opportunity_auto_scan', { categories: 'trend,saas', max_results: 5 }, ctx)
  assert(o.ok === true, 'opportunity_auto_scan succeeds')
  assert(o.result.includes('OPPORTUNITIES') || o.result.includes('opportunities'), 'returns opportunity data')

  // 4. risk_model_advanced
  console.log('\n--- 4. risk_model_advanced ---')
  const r = await dispatchTool('risk_model_advanced', { strategy: 'Invest $5000 in dividend stocks', investment: 5000, category: 'investment', timeframe_months: 12 }, ctx)
  assert(r.ok === true, 'risk_model_advanced succeeds')
  assert(r.result.includes('RISK'), 'has risk level')
  assert(r.result.includes('VaR') || r.result.includes('Value at Risk'), 'has VaR metric')
  assert(r.result.includes('Sharpe'), 'has Sharpe ratio')

  // 5. memory_graph
  console.log('\n--- 5. memory_graph ---')
  const ms = await dispatchTool('memory_graph', { action: 'store', key: 'test_enhanced_001', value: 'Test memory for enhanced tools', category: 'fact', relates_to: 'risk_model_advanced', relation_type: 'tested_by' }, ctx)
  assert(ms.ok === true, 'memory_graph store succeeds')
  const mr = await dispatchTool('memory_graph', { action: 'recall', query: 'test_enhanced' }, ctx)
  assert(mr.ok === true, 'memory_graph recall succeeds')
  assert(mr.result.includes('test_enhanced_001'), 'recalled the memory')
  assert(mr.result.includes('RELATION') || mr.result.includes('Relation'), 'shows relationship')

  // 6. ab_test_framework
  console.log('\n--- 6. ab_test_framework ---')
  const ab = await dispatchTool('ab_test_framework', { action: 'analyze', name: 'Pricing Test', hypothesis: '$9.99 better than $14.99', control_conversions: 50, control_visitors: 1000, variant_conversions: 65, variant_visitors: 1000 }, ctx)
  assert(ab.ok === true, 'ab_test_framework analyze succeeds')
  assert(ab.result.includes('Z-score'), 'has z-score')
  assert(ab.result.includes('Confidence'), 'has confidence level')
  assert(ab.result.includes('WINNER') || ab.result.includes('winner'), 'has winner declaration')

  // 7. scaling_predictive
  console.log('\n--- 7. scaling_predictive ---')
  const sp = await dispatchTool('scaling_predictive', { asset: 'blog traffic', current_value: 100, target_value: 10000, timeframe_days: 90, strategy: 'organic' }, ctx)
  assert(sp.ok === true, 'scaling_predictive succeeds')
  assert(sp.result.includes('GROWTH'), 'has growth analysis')
  assert(sp.result.includes('PROJECTION'), 'has projection')
  assert(sp.result.includes('MILESTONES') || sp.result.includes('milestones'), 'has milestones')

  // 8. platform_connect
  console.log('\n--- 8. platform_connect ---')
  const pl = await dispatchTool('platform_connect', { action: 'list' }, ctx)
  assert(pl.ok === true, 'platform_connect list succeeds')
  assert(pl.result.includes('Shopify'), 'lists Shopify')
  assert(pl.result.includes('YouTube'), 'lists YouTube')
  assert(pl.result.includes('Stripe'), 'lists Stripe')
  const plc = await dispatchTool('platform_connect', { action: 'connect', platform: 'shopify', account_name: 'Test Store', api_key: 'shpat_test123', api_secret: 'shpss_test456' }, ctx)
  assert(plc.ok === true, 'platform_connect connect succeeds')
  assert(plc.result.includes('Connected'), 'confirms connection')
  const pll = await dispatchTool('platform_connect', { action: 'list_connections' }, ctx)
  assert(pll.ok === true, 'platform_connect list_connections succeeds')
  assert(pll.result.includes('shopify'), 'shows connected shopify')
  // Cleanup
  await dispatchTool('platform_connect', { action: 'disconnect', platform: 'shopify' }, ctx)

  console.log(`\n${'='.repeat(60)}\nRESULT: ${pass} passed, ${fail} failed\n${'='.repeat(60)}`)
  if (fail > 0) process.exit(1)
}
main().catch(e => { console.error('Crashed:', e); process.exit(1) })
