import { db } from '../src/lib/db'

async function cleanup() {
  // Find conversations with messages containing wrong numbers
  const messages = await db.message.findMany({
    where: {
      OR: [
        { content: { contains: 'Available Tools: 14' } },
        { content: { contains: 'Management Actions: 25' } },
        { content: { contains: 'Self-Audit Report' } },
        { content: { contains: 'Capabilities Inventory' } },
      ]
    },
    select: { id: true, conversationId: true, role: true, content: true }
  })
  
  console.log(`Messages with wrong audit numbers: ${messages.length}`)
  for (const m of messages.slice(0, 5)) {
    console.log(`  - conv=${m.conversationId.slice(0,12)} role=${m.role} content="${m.content.slice(0, 100)}..."`)
  }
  
  if (messages.length > 0) {
    // Delete these specific messages (not the whole conversation)
    const msgIds = messages.map(m => m.id)
    const result = await db.message.deleteMany({ where: { id: { in: msgIds } } })
    console.log(`\n✅ Deleted ${result.count} messages with wrong audit numbers`)
  }
  
  process.exit(0)
}
cleanup().catch(e => { console.error(e); process.exit(1) })
