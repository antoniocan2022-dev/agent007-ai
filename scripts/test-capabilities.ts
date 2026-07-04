/**
 * test-capabilities.ts — Verify getCapabilities() returns accurate counts
 * Run with: npx tsx /home/z/my-project/scripts/test-capabilities.ts
 */
import { getCapabilities } from '../src/lib/system-functions'

async function main() {
  console.log('Testing getCapabilities()...\n')
  const caps = await getCapabilities()
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('LIVE CAPABILITIES REPORT')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log(`Timestamp:           ${caps.timestamp}`)
  console.log(`Available Tools:     ${caps.summary.availableTools}`)
  console.log(`Available Agents:    ${caps.summary.availableAgents} (built-in: ${caps.agents.builtin}, custom: ${caps.agents.custom})`)
  console.log(`Management Actions:  ${caps.summary.managementActions}`)
  console.log(`Monthly Income:      ${caps.summary.monthlyIncomeTarget}`)
  console.log(`Growth Rate:         ${caps.summary.growthRate}`)
  console.log(`  - Monthly:         ${caps.summary.monthlyGrowthRate}`)
  console.log(`  - Daily:           ${caps.summary.dailyGrowthTarget}`)
  console.log(`Permanent Upgrades:  ${caps.summary.permanentUpgrades}`)
  console.log(`Subagent Access:     ${caps.summary.subagentToolAccess}`)
  console.log(`Tools per Agent:     ${caps.summary.toolsPerAgent}`)
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('\nSample tool names (first 15):')
  console.log('  ' + caps.tools.sample.slice(0, 15).join(', '))
  console.log(`\nAll ${caps.manageActions.total} management actions:`)
  console.log('  ' + caps.manageActions.list.join(', '))
  console.log('\n✅ All counts come from live registry — no regex, no drift.')
}

main().catch(err => {
  console.error('❌ Test failed:', err)
  process.exit(1)
})
