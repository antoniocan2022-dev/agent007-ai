import { db } from '../src/lib/db'

async function check() {
  const fifteenHoursAgo = new Date(Date.now() - 15 * 60 * 60 * 1000)
  console.log('Checking since:', fifteenHoursAgo.toISOString())
  console.log()
  
  // Check audit log
  const auditLogs = await db.auditLog.findMany({
    where: { 
      timestamp: { gte: fifteenHoursAgo }
    },
    orderBy: { timestamp: 'desc' },
    take: 50,
  }).catch(() => [])
  
  console.log('=== AUDIT LOG (last 15 hours) ===')
  console.log('Total entries:', auditLogs.length)
  console.log()
  
  // Filter for reset/delete/disable operations
  const resetOps = auditLogs.filter(a => 
    a.action.toLowerCase().includes('reset') ||
    a.action.toLowerCase().includes('delete') ||
    a.action.toLowerCase().includes('wipe') ||
    a.action.toLowerCase().includes('disable') ||
    a.action.toLowerCase().includes('force') ||
    a.action.toLowerCase().includes('clear')
  )
  
  if (resetOps.length > 0) {
    console.log('⚠️  RESET/DELETE OPERATIONS FOUND:')
    for (const a of resetOps) {
      console.log('  -', a.timestamp.toISOString(), '|', a.action, '|', a.description)
    }
  } else {
    console.log('✅ No reset/delete operations found in audit log')
  }
  console.log()
  
  // Show all audit entries
  if (auditLogs.length > 0) {
    console.log('=== ALL AUDIT ENTRIES ===')
    for (const a of auditLogs) {
      console.log('  -', a.timestamp.toISOString().slice(0,19), '|', a.action, '|', a.description?.slice(0, 60))
    }
  } else {
    console.log('No audit log entries in the last 15 hours')
  }
  
  process.exit(0)
}
check().catch(e => { console.error(e); process.exit(1) })
