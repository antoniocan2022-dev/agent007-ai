import { db } from '@/lib/db'
import { sanitizeMemoryFields, sanitizeMemoryText } from '@/lib/memory-text'

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

type MemoryIdRow = { id: string }
type MemoryHexRow = {
  id: string
  key_hex: string
  value_hex: string
  category_hex: string
  created_at: Date
  updated_at: Date
}

function decodeUtf8Hex(hex: string): string {
  return Buffer.from(hex, 'hex').toString('utf8')
}

function toSafeRecord(row: MemoryRecord): MemoryRecord {
  const safe = sanitizeMemoryFields({ key: row.key, value: row.value, category: row.category })
  return { ...row, ...safe }
}

/**
 * Load one memory without allowing a single malformed text value to take down
 * the entire memory subsystem. If Prisma's normal JSON transport fails, read
 * the row as UTF-8 hex through PostgreSQL, sanitize it, and repair it.
 */
async function loadMemoryById(id: string): Promise<MemoryRecord | null> {
  try {
    const row = await db.memory.findUnique({ where: { id } })
    if (!row) return null

    const safe = toSafeRecord(row)
    if (safe.key !== row.key || safe.value !== row.value || safe.category !== row.category) {
      try {
        await db.memory.update({
          where: { id },
          data: { key: safe.key, value: safe.value, category: safe.category },
        })
      } catch (repairError) {
        console.warn('[memory] Sanitized row in memory but could not persist repair', {
          id,
          error: repairError instanceof Error ? repairError.message.slice(0, 180) : String(repairError).slice(0, 180),
        })
      }
    }
    return safe
  } catch (primaryError) {
    try {
      // Return only ASCII hex from PostgreSQL so Prisma's JSON transport never
      // has to deserialize the suspect text directly.
      const rows = await db.$queryRaw<MemoryHexRow[]>`
        SELECT
          id,
          encode(convert_to("key", 'UTF8'), 'hex') AS key_hex,
          encode(convert_to(value, 'UTF8'), 'hex') AS value_hex,
          encode(convert_to(category, 'UTF8'), 'hex') AS category_hex,
          "createdAt" AS created_at,
          "updatedAt" AS updated_at
        FROM "Memory"
        WHERE id = ${id}
        LIMIT 1
      `
      const raw = rows[0]
      if (!raw) return null

      const safeFields = sanitizeMemoryFields({
        key: decodeUtf8Hex(raw.key_hex),
        value: decodeUtf8Hex(raw.value_hex),
        category: decodeUtf8Hex(raw.category_hex),
      })

      try {
        await db.$executeRaw`
          UPDATE "Memory"
          SET "key" = ${safeFields.key},
              value = ${safeFields.value},
              category = ${safeFields.category},
              "updatedAt" = NOW()
          WHERE id = ${id}
        `
      } catch (repairError) {
        console.warn('[memory] Recovered a row but could not persist its repair', {
          id,
          error: repairError instanceof Error ? repairError.message.slice(0, 180) : String(repairError).slice(0, 180),
        })
      }

      console.warn('[memory] Recovered and sanitized a memory row after Prisma deserialization failure', {
        id,
        error: primaryError instanceof Error ? primaryError.message.slice(0, 180) : String(primaryError).slice(0, 180),
      })

      return {
        id: raw.id,
        ...safeFields,
        createdAt: raw.created_at,
        updatedAt: new Date(),
      }
    } catch (recoveryError) {
      console.error('[memory] Unable to recover memory row', {
        id,
        error: recoveryError instanceof Error ? recoveryError.message.slice(0, 180) : String(recoveryError).slice(0, 180),
      })
      return null
    }
  }
}

async function loadMemoryIds(where?: { category?: string }): Promise<string[]> {
  try {
    const rows = await db.memory.findMany({
      where: where?.category ? { category: where.category } : undefined,
      select: { id: true },
      orderBy: { updatedAt: 'desc' },
    })
    return rows.map((row) => row.id)
  } catch (error) {
    // ID-only fallback is ASCII-only and avoids deserializing Memory text.
    try {
      const rows = where?.category
        ? await db.$queryRaw<MemoryIdRow[]>`
            SELECT id
            FROM "Memory"
            WHERE category = ${where.category}
            ORDER BY "updatedAt" DESC
          `
        : await db.$queryRaw<MemoryIdRow[]>`
            SELECT id
            FROM "Memory"
            ORDER BY "updatedAt" DESC
          `
      return rows.map((row) => row.id)
    } catch (fallbackError) {
      console.error('[memory] Unable to enumerate memory IDs', {
        error: fallbackError instanceof Error ? fallbackError.message.slice(0, 180) : String(fallbackError).slice(0, 180),
        primary: error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180),
      })
      return []
    }
  }
}

async function loadMemoriesByIds(ids: string[], limit?: number): Promise<MemoryRecord[]> {
  const output: MemoryRecord[] = []
  const max = limit === undefined ? ids.length : Math.max(0, limit)
  if (max === 0) return output

  // Deliberately sequential: a problematic row is isolated and the remaining
  // memories remain available. Memory is a resilience boundary.
  for (const id of ids) {
    if (output.length >= max) break
    const row = await loadMemoryById(id)
    if (row) output.push(row)
  }
  return output
}

export async function listMemories(category?: string): Promise<MemoryRecord[]> {
  const safeCategory = category ? sanitizeMemoryText(category) : undefined
  const ids = await loadMemoryIds(safeCategory ? { category: safeCategory } : undefined)
  return loadMemoriesByIds(ids)
}

export async function upsertMemory(
  key: string,
  value: string,
  category: string = 'general'
): Promise<MemoryRecord> {
  const safe = sanitizeMemoryFields({ key, value, category })
  return db.memory.upsert({
    where: { key: safe.key },
    update: { value: safe.value, category: safe.category, updatedAt: new Date() },
    create: { key: safe.key, value: safe.value, category: safe.category },
  })
}

export async function recallMemories(query: string, limit = 10): Promise<MemoryRecord[]> {
  const safeLimit = Math.max(0, Math.min(100, Math.floor(limit)))
  const q = sanitizeMemoryText(query.trim().toLowerCase())
  if (safeLimit === 0) return []

  if (!q) {
    const ids = await loadMemoryIds()
    return loadMemoriesByIds(ids, safeLimit)
  }

  const terms = q.split(/\s+/).filter(Boolean)
  const filters = terms.flatMap((t) => [
    { key: { contains: t } },
    { value: { contains: t } },
    { category: { contains: t } },
  ])

  try {
    const rows = await db.memory.findMany({
      where: { OR: filters },
      select: { id: true },
      orderBy: { updatedAt: 'desc' },
      take: Math.max(safeLimit * 3, safeLimit),
    })
    return loadMemoriesByIds(rows.map((row) => row.id), safeLimit)
  } catch {
    // Recoverable fallback: enumerate IDs, isolate each row, then filter only
    // after safe text has been loaded. This prevents one bad row from poisoning
    // the entire recall operation.
    const ids = await loadMemoryIds()
    const loaded = await loadMemoriesByIds(ids)
    return loaded
      .filter((memory) => {
        const text = `${memory.key} ${memory.value} ${memory.category}`.toLowerCase()
        return terms.some((term) => text.includes(term))
      })
      .slice(0, safeLimit)
  }
}

export async function deleteMemory(key: string): Promise<void> {
  const safeKey = sanitizeMemoryText(key)
  await db.memory.deleteMany({ where: { key: safeKey } })
}

export function formatMemoryForPrompt(memories: MemoryRecord[]): string {
  if (!memories.length) return '(no stored memories yet)'
  return memories
    .map((m) => `- [${sanitizeMemoryText(m.category)}] ${sanitizeMemoryText(m.key)}: ${sanitizeMemoryText(m.value)}`)
    .join('\n')
}
