import { db } from '../src/lib/db'
async function main() {
  const subs = await db.customSubagent.findMany({})
  console.log('Total sub-agents:', subs.length)
  const targets = ['Cybersecurity A', 'Cybersecurity R', 'LEGAL', 'THE BANKER', 'Developer', 'TRADER']
  for (const s of subs) {
    if (targets.includes(s.name)) {
      let tools: any[] = []
      try { tools = JSON.parse(s.allowedTools || '[]') } catch {}
      console.log('')
      console.log('═══ ' + s.name + ' ═══')
      console.log('  ID:', s.id)
      console.log('  Role:', s.role)
      console.log('  Specialty:', (s.specialty || '').slice(0, 150))
      console.log('  Icon:', s.icon)
      console.log('  Enabled:', s.enabled)
      console.log('  Tools (' + tools.length + '):', tools.join(', '))
      console.log('  System prompt length:', (s.systemPrompt || '').length, 'chars')
    }
  }
  console.log('')
  console.log('═══ MEMORY ═══')
  const mems = await db.memory.findMany({})
  console.log('Total memory records:', mems.length)
  for (const m of mems) console.log('  [' + m.category + '] ' + m.key.slice(0, 55))
  console.log('')
  console.log('═══ SCHEDULES ═══')
  const scheds = await db.schedule.findMany({})
  console.log('Total schedules:', scheds.length)
  for (const s of scheds) console.log('  ' + (s.enabled ? '✅' : '❌') + ' ' + s.name + ' (every ' + s.intervalMin + 'min)')
}
main().catch(console.error).finally(() => db.$disconnect())
