import { db } from '../src/lib/db'

async function check() {
  const fifteenHoursAgo = new Date(Date.now() - 15 * 60 * 60 * 1000)
  
  const notifs = await db.notificationLog.findMany({
    where: { createdAt: { gte: fifteenHoursAgo } },
    orderBy: { createdAt: 'desc' },
    take: 20,
  }).catch(() => [])
  
  console.log('Notification log entries (last 15h):', notifs.length)
  for (const n of notifs) {
    console.log('  -', n.createdAt.toISOString().slice(0,19), '|', n.type, '|', n.subject?.slice(0, 50))
  }
  
  process.exit(0)
}
check().catch(e => { console.error(e); process.exit(1) })
