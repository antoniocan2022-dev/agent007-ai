import { db } from '../src/lib/db'
import { setIncomeSettings, getIncomeSettings } from '../src/lib/settings'

async function fix() {
  const current = await getIncomeSettings()
  console.log('Current:', current)
  
  await setIncomeSettings({
    ...current,
    monthlyGoal: 20000,
    dailyGrowthTarget: 10,
  })
  
  const updated = await getIncomeSettings()
  console.log('Updated:', updated)
  process.exit(0)
}
fix().catch(e => { console.error(e); process.exit(1) })
