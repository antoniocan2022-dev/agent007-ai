import { db } from '../src/lib/db'
async function list() {
  const convs = await db.conversation.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 10,
    include: { _count: { select: { messages: true } } },
  })
  console.log(`Total conversations: ${await db.conversation.count()}`)
  console.log(`Total messages: ${await db.message.count()}`)
  console.log()
  console.log('Recent 10 conversations:')
  for (const c of convs) {
    const age = Math.round((Date.now() - new Date(c.updatedAt).getTime()) / 60000)
    console.log(`  ${age}min ago | ${c._count.messages} msgs | ${c.title.slice(0,80)}`)
  }
  process.exit(0)
}
list().catch(e => { console.error(e); process.exit(1) })
