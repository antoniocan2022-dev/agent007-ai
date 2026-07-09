import { db } from '../src/lib/db'
import { setIncomeSettings, getIncomeSettings } from '../src/lib/settings'

async function fix() {
  const current = await getIncomeSettings()
  console.log('Current income settings:', current)
  
  await setIncomeSettings({
    ...current,
    monthlyGoal: 20000,  // Fix: was 1500, should be 20000 per mission
    dailyGrowthTarget: 10,  // 10% daily = ~20% monthly compound
  })
  
  const updated = await getIncomeSettings()
  console.log('Updated income settings:', updated)
  console.log('✅ Income goal fixed to $20,000/month')
  
  process.exit(0)
}
fix().catch(e => { console.error(e); process.exit(1) })
