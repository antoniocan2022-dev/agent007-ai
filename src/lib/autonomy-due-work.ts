import { db } from './db'

export type DueWorkId = 'portfolio-learning' | 'capability-probe' | 'venture-operation'

export interface DueWorkResult {
  id: DueWorkId
  due: boolean
  lastRunAt: number | null
  nextDueAt: number
}

function key(id: DueWorkId) { return `autonomy:due-work:${id}` }

export async function getDueWork(id: DueWorkId, intervalMs: number, now = Date.now()): Promise<DueWorkResult> {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new Error(`Invalid due-work interval for ${id}.`)
  const row = await db.memory.findUnique({ where: { key: key(id) }, select: { value: true } })
  let lastRunAt: number | null = null
  if (row) {
    try {
      const parsed = JSON.parse(row.value) as { lastRunAt?: unknown }
      if (typeof parsed.lastRunAt === 'number' && Number.isFinite(parsed.lastRunAt)) lastRunAt = parsed.lastRunAt
    } catch { /* malformed schedule state is treated as unknown/not-run */ }
  }
  const nextDueAt = (lastRunAt ?? 0) + intervalMs
  return { id, due: lastRunAt === null || now >= nextDueAt, lastRunAt, nextDueAt }
}

export async function markDueWorkCompleted(id: DueWorkId, completedAt = Date.now()): Promise<void> {
  await db.memory.upsert({
    where: { key: key(id) },
    update: { category: 'autonomy_due_work', value: JSON.stringify({ id, lastRunAt: completedAt }) },
    create: { key: key(id), category: 'autonomy_due_work', value: JSON.stringify({ id, lastRunAt: completedAt }) },
  })
}
