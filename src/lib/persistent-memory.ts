/**
 * persistent-memory.ts — Persistent memory layer (upgrade #52)
 *
 * Triple-store: Redis (if configured) → /tmp file → DB
 * Ensures learnings survive Vercel cold starts.
 */

import { db } from './db'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

const MEMORY_FILE = path.join(os.tmpdir(), 'agent007-persistent-memory.json')
// UPGRADE #171: Memory now persists FOREVER — owner requested no expiration.
// Antonio can still UPDATE a learning's score (via updateMemoryScore), which
// adjusts the entry's score ±10 per outcome. The score still has a 0-100
// range; only the EXPIRATION is removed. Old memories keep their score and
// remain recallable forever.
// (Before #171: MEMORY_TTL_MS was 90 days. recallPersistentMemory filtered out
// anything older. Now: Infinity — never expired.)
const MEMORY_TTL_MS = Infinity

interface MemoryEntry {
  key: string
  value: string
  category: string
  createdAt: number
  score: number  // success score (0-100, higher = better learning)
  timesRecalled: number
}

// ─── FILE-BASED PERSISTENT STORE ─────────────────────────────────
let _fileCache: MemoryEntry[] | null = null
let _fileCacheAt = 0
const FILE_CACHE_TTL = 30 * 1000  // 30 seconds

function loadFromFile(): MemoryEntry[] {
  if (_fileCache && Date.now() - _fileCacheAt < FILE_CACHE_TTL) return _fileCache
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      const raw = fs.readFileSync(MEMORY_FILE, 'utf-8')
      _fileCache = JSON.parse(raw)
      _fileCacheAt = Date.now()
      return _fileCache!
    }
  } catch {}
  _fileCache = []
  _fileCacheAt = Date.now()
  return _fileCache!
}

function saveToFile(entries: MemoryEntry[]): void {
  try {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(entries, null, 2))
    _fileCache = entries
    _fileCacheAt = Date.now()
  } catch {}
}

// ─── PUBLIC API ──────────────────────────────────────────────────

/**
 * Store a memory persistently (file + DB).
 * Score = how successful this learning was (0-100, default 50).
 */
export async function storePersistentMemory(
  key: string,
  value: string,
  category: string = 'general',
  score: number = 50
): Promise<void> {
  const entry: MemoryEntry = {
    key,
    value,
    category,
    createdAt: Date.now(),
    score: Math.max(0, Math.min(100, score)),
    timesRecalled: 0,
  }

  // Store in file
  const entries = loadFromFile()
  const existingIdx = entries.findIndex(e => e.key === key)
  if (existingIdx >= 0) {
    entries[existingIdx] = entry  // update
  } else {
    entries.push(entry)
  }
  saveToFile(entries)

  // Store in DB (best-effort)
  try {
    await db.memory.upsert({
      where: { key },
      create: { key, value, category },
      update: { value, category },
    }).catch(() => {})
  } catch {}
}

/**
 * Recall memories by query (keyword match on key + value + category).
 * Returns top N results, sorted by score (desc) + recency.
 */
export async function recallPersistentMemory(
  query: string,
  limit: number = 5
): Promise<MemoryEntry[]> {
  const queryLower = query.toLowerCase()
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2)

  // Load from file (persistent across cold starts)
  const fileEntries = loadFromFile()

  // Also try DB (may have more entries from other instances)
  let dbEntries: MemoryEntry[] = []
  try {
    const dbMems = await db.memory.findMany({ take: 100 }).catch(() => [])
    dbEntries = dbMems.map(m => ({
      key: m.key,
      value: m.value,
      category: m.category,
      createdAt: m.createdAt.getTime(),
      score: 50,  // default
      timesRecalled: 0,
    }))
  } catch {}

  // Merge + deduplicate (file takes priority)
  const merged = new Map<string, MemoryEntry>()
  for (const e of dbEntries) merged.set(e.key, e)
  for (const e of fileEntries) merged.set(e.key, e)  // file overrides

  // Score by relevance + quality
  const scored = Array.from(merged.values())
    .filter(e => {
      // UPGRADE #171: MEMORY_TTL_MS is now Infinity — no expiration.
      // (Before: `if (Date.now() - e.createdAt > MEMORY_TTL_MS) return false`
      // would filter out anything older than 90 days. The check is kept
      // here so the behavior is explicit: Infinity is never greater than
      // the age, so the check always passes.)
      if (Date.now() - e.createdAt > MEMORY_TTL_MS) return false
      // Keyword match
      const text = `${e.key} ${e.value} ${e.category}`.toLowerCase()
      return queryWords.some(w => text.includes(w))
    })
    .map(e => {
      let relevance = 0
      for (const w of queryWords) {
        if (e.key.toLowerCase().includes(w)) relevance += 3
        if (e.value.toLowerCase().includes(w)) relevance += 2
        if (e.category.toLowerCase().includes(w)) relevance += 1
      }
      // UPGRADE #171: No age decay — memory is forever, so old
      // high-scoring memories are just as valuable as recent ones. The
      // score itself (0-100) is what matters, not age. Antonio can update
      // scores via updateMemoryScore to nudge them up or down based on
      // fresh outcomes.
      // (Before: decayFactor = max(0.5, 1 - ageDays / 90) — older memories
      // had their score multiplied by 0.5 at 90 days. Now: decayFactor = 1
      // always, score is preserved at full value.)
      const decayFactor = 1
      return { ...e, relevance, finalScore: e.score * decayFactor + relevance * 10 }
    })
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, limit)

  // Increment recall count
  for (const e of scored) {
    e.timesRecalled++
  }
  if (scored.length > 0) saveToFile(fileEntries)

  return scored
}

/**
 * Update a memory's score (called after a decision succeeds or fails).
 */
export async function updateMemoryScore(key: string, success: boolean): Promise<void> {
  const entries = loadFromFile()
  const entry = entries.find(e => e.key === key)
  if (entry) {
    // Move score toward 100 (success) or 0 (failure) by 10 points
    entry.score = Math.max(0, Math.min(100, entry.score + (success ? 10 : -10)))
    saveToFile(entries)
  }
}

/**
 * Get all persistent memories (for backup/debugging).
 */
export async function getAllPersistentMemory(): Promise<MemoryEntry[]> {
  return loadFromFile()
}
