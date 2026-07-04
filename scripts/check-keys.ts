import { db } from '../src/lib/db'
async function check() {
  const keys = await db.apiKey.findMany()
  console.log('API keys in DB:', keys.length)
  for (const k of keys) {
    console.log('  id:', k.id.slice(0,12), 'service:', (k as any).service || 'N/A', 'key:', k.key?.slice(0,15) + '...')
  }
  process.exit(0)
}
check().catch(e => { console.error(e); process.exit(1) })
