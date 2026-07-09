import { db } from '../src/lib/db'
import { setIncomeSettings, getIncomeSettings } from '../src/lib/settings'
async function fix() {
  const c = await getIncomeSettings()
  await setIncomeSettings({ ...c, monthlyGoal: 20000, dailyGrowthTarget: 10 })
  console.log('Income fixed to $20,000')
  process.exit(0)
}
fix().catch(e => { console.error(e); process.exit(1) })
