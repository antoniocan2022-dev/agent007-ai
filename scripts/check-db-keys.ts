import { db } from '../src/lib/db'
async function check() {
  const keys = await db.apiKey.findMany()
  console.log('API keys in DB:', keys.length)
  for (const k of keys) {
    console.log('  - id:', k.id.slice(0, 12))
    console.log('    name:', k.name)
    console.log('    service:', (k as any).service || 'N/A')
    console.log('    key preview:', (k.key || k.keyEncrypted || '').slice(0, 15) + '...')
    console.log('    created:', k.createdAt)
  }
  process.exit(0)
}
check().catch(e => { console.error(e); process.exit(1) })
