import { db } from '../src/lib/db'
async function check() {
  const memories = await db.memory.findMany({
    where: { OR: [
      { key: { contains: 'MISSION' } },
      { key: { contains: 'mission' } },
      { key: { contains: '20K' } },
      { key: { contains: '20k' } },
      { key: { contains: 'DIRECTIVE' } },
    ]}
  })
  console.log('Mission memories: ' + memories.length)
  for (const m of memories.slice(0, 3)) {
    console.log('  [' + m.key + '] ' + m.value.slice(0, 120))
  }
  process.exit(0)
}
check().catch(e => { console.error(e); process.exit(1) })
