/**
 * update-db-settings.ts — Update the local DB's income_settings row to use
 * dailyGrowthTarget=20 (was 10). Run once before deploying to Vercel so
 * the local /api/system/capabilities endpoint reflects the new value.
 */
import { db, ensureDbReady } from '../src/lib/db'
import { setIncomeSettings, DEFAULT_INCOME_SETTINGS } from '../src/lib/settings'

async function main() {
  await ensureDbReady()
  const newSettings = { ...DEFAULT_INCOME_SETTINGS, dailyGrowthTarget: 20 }
  const ok = await setIncomeSettings(newSettings)
  console.log('Settings update:', ok ? '✅ SUCCESS' : '❌ FAILED')
  console.log('New settings:', JSON.stringify(newSettings, null, 2))
  // Verify by reading back
  const { getIncomeSettings } = await import('../src/lib/settings')
  const read = await getIncomeSettings()
  console.log('Read-back:', JSON.stringify(read, null, 2))
  process.exit(0)
}

main().catch(e => { console.error('❌', e); process.exit(1) })
