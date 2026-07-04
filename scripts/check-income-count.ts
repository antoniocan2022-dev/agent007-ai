import { db } from '../src/lib/db'
async function check() {
  const incomeCount = await db.incomeEntry.count()
  console.log('Income entries:', incomeCount)
  process.exit(0)
}
check().catch(e => { console.error(e); process.exit(1) })
