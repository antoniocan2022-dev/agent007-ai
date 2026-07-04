import { db } from '../src/lib/db'
async function check() {
  const keys = await db.apiKey.findMany()
  console.log('API keys in DB:', keys.length)
  for (const k of keys) {
    console.log('  - id:', k.id.slice(0, 12))
    console.log('    name:', k.name)
    console.log('    provider:', k.provider)
    console.log('    key preview:', k.keyEncrypted?.slice(0, 10) + '...' ?? '(empty)')
    console.log('    enabled:', k.enabled)
    console.log('    created:', k.createdAt)
  }
  process.exit(0)
}
check().catch(e => { console.error(e); process.exit(1) })
