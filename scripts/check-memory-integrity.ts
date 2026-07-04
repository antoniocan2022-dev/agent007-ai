import { db } from '../src/lib/db'
async function check() {
  const memories = await db.memory.findMany()
  console.log('Total memory records:', memories.length)
  console.log()
  
  // Check for critical memories
  const critical = ['AGENT007_LOYALTY_OATH', 'OWNER_PHONE_PERMANENT', 'PRIME_DIRECTIVE_20K_MISSION', 'OWNER_AUTHORIZATION_REQUIRED']
  for (const key of critical) {
    const m = memories.find(x => x.key === key)
    if (m) {
      console.log('✅', key, '— present')
    } else {
      console.log('❌', key, '— MISSING (reset may have occurred)')
    }
  }
  
  process.exit(0)
}
check().catch(e => { console.error(e); process.exit(1) })
