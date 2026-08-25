import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getDueWork } from '@/lib/autonomy-due-work'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const due = await getDueWork('portfolio-learning', 45 * 60 * 1000)
  const [heartbeat, latestLearning] = await Promise.all([
    db.memory.findUnique({ where: { key: 'portfolio-intelligence:heartbeat:last' }, select: { value: true, updatedAt: true } }),
    db.memory.findMany({ where: { category: 'portfolio_intelligence_learning' }, orderBy: { updatedAt: 'desc' }, take: 20, select: { value: true, updatedAt: true } }),
  ])
  let heartbeatState: Record<string, unknown> | null = null
  try { heartbeatState = heartbeat ? JSON.parse(heartbeat.value) as Record<string, unknown> : null } catch { heartbeatState = null }
  return NextResponse.json({
    due,
    heartbeat: heartbeatState,
    heartbeatUpdatedAt: heartbeat?.updatedAt ?? null,
    recentLearningCount: latestLearning.length,
    recentLearning: latestLearning.map((row) => {
      try { return { ...JSON.parse(row.value) as Record<string, unknown>, updatedAt: row.updatedAt } } catch { return { malformed: true, updatedAt: row.updatedAt } }
    }),
    truthRule: 'Learning is observable only from persisted heartbeat/learning records; absence is not inferred as success.',
  }, { headers: { 'Cache-Control': 'private, max-age=15, stale-while-revalidate=30' } })
}
