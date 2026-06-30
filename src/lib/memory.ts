import { db } from '@/lib/db'

export type MemoryCategory =
  | 'general'
  | 'preference'
  | 'fact'
  | 'goal'
  | 'income_idea'
  | 'project'
  | 'skill'

export interface MemoryRecord {
  id: string
  key: string
  value: string
  category: string
  createdAt: Date
  updatedAt: Date
}

export async function listMemories(category?: string): Promise<MemoryRecord[]> {
  if (category) {
    return db.memory.findMany({ where: { category }, orderBy: { updatedAt: 'desc' } })
  }
  return db.memory.findMany({ orderBy: { updatedAt: 'desc' } })
}

export async function upsertMemory(
  key: string,
  value: string,
  category: string = 'general'
): Promise<MemoryRecord> {
  return db.memory.upsert({
    where: { key },
    update: { value, category, updatedAt: new Date() },
    create: { key, value, category },
  })
}

export async function recallMemories(query: string, limit = 10): Promise<MemoryRecord[]> {
  const q = query.trim().toLowerCase()
  if (!q) {
    return db.memory.findMany({ orderBy: { updatedAt: 'desc' }, take: limit })
  }
  // SQLite LIKE is case-insensitive for ASCII by default; build a disjunction
  const terms = q.split(/\s+/).filter(Boolean)
  const filters = terms.flatMap((t) => [
    { key: { contains: t } },
    { value: { contains: t } },
    { category: { contains: t } },
  ])
  return db.memory.findMany({
    where: { OR: filters },
    orderBy: { updatedAt: 'desc' },
    take: limit,
  })
}

export async function deleteMemory(key: string): Promise<void> {
  await db.memory.deleteMany({ where: { key } })
}

export function formatMemoryForPrompt(memories: MemoryRecord[]): string {
  if (!memories.length) return '(no stored memories yet)'
  return memories
    .map((m) => `- [${m.category}] ${m.key}: ${m.value}`)
    .join('\n')
}
