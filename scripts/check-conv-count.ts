import { db } from '../src/lib/db'
async function check() {
  const convCount = await db.conversation.count()
  const msgCount = await db.message.count()
  console.log('Conversations:', convCount)
  console.log('Messages:', msgCount)
  process.exit(0)
}
check().catch(e => { console.error(e); process.exit(1) })
