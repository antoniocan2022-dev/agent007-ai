import { db } from '../src/lib/db'
async function list() {
  const schedules = await db.schedule.findMany({ orderBy: { nextRunAt: 'asc' } })
  console.log(`Total schedules: ${schedules.length}`)
  for (const s of schedules) {
    const enabled = s.enabled ? 'ON ' : 'OFF'
    const next = s.nextRunAt ? new Date(s.nextRunAt).toISOString().slice(0,16) : 'never'
    console.log(`  [${enabled}] ${s.name}`)
    console.log(`         interval: ${s.intervalMin}min | next: ${next} | id: ${s.id.slice(0,12)}`)
    console.log(`         prompt: ${s.prompt.slice(0,80)}...`)
  }
  process.exit(0)
}
list().catch(e => { console.error(e); process.exit(1) })
