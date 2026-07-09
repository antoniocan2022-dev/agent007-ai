import { db } from '../src/lib/db'
async function list() {
  const models = Object.keys(db).filter(k => !k.startsWith('_') && !k.startsWith('$') && typeof (db as any)[k]?.count === 'function')
  console.log(`Total Prisma models: ${models.length}`)
  for (const m of models.sort()) {
    try {
      const count = await (db as any)[m].count()
      console.log(`  ${m}: ${count} rows`)
    } catch (e: any) {
      console.log(`  ${m}: ERROR — ${e.message?.slice(0,60)}`)
    }
  }
  process.exit(0)
}
list().catch(e => { console.error(e); process.exit(1) })
