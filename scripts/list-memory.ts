import { db } from '../src/lib/db'
async function list() {
  const memories = await db.memory.findMany({ orderBy: { updatedAt: 'desc' } })
  console.log(`Total memory records: ${memories.length}`)
  for (const m of memories.slice(0, 15)) {
    console.log(`  [${m.category}] ${m.key}`)
    console.log(`         ${m.value.slice(0, 100)}${m.value.length > 100 ? '...' : ''}`)
  }
  if (memories.length > 15) console.log(`  ... and ${memories.length - 15} more`)
  process.exit(0)
}
list().catch(e => { console.error(e); process.exit(1) })
