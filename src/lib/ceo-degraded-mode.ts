/**
 * persistent-memory.ts — Persistent memory layer (upgrade #52, #171, #172)
 *
 * Two-tier store: /tmp file → DB. Ensures learnings survive Vercel cold starts.
 *
 * UPGRADE #172: Removed the misleading "Triple-store: Redis (if configured)"
 * claim from the header. A prior audit (AUDIT-REDIS-ACCURACY) confirmed:
 *   - This file has ZERO Redis code (only fs, path, os, db imports)
 *   - The Redis tier was aspirational in the original #52 design but never
 *     implemented.
 *   - Production Vercel has REDIS_API_KEY, UPSTASH_REDIS_REST_URL,
 *     UPSTASH_REDIS_REST_TOKEN env vars set, but they're EMPTY (length 0)
 *     and not read by this file anyway.
 * If a future agent wants Redis, they need to actually implement it here
 * (import ioredis, ping REDIS_URL on init, fallback to file+DB on failure).
 *
 * UPGRADE #171: Memory TTL changed from 90 days to Infinity — Antonio wants
 * memory forever. decayFactor is 1 (no age decay). Antonio can still update
 * scores via updateMemoryScore (±10 per outcome).
 */

import { db } from './db'
import { sanitizeMemoryFields, sanitizeMemoryText } from './memory-text'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { emitConversationIncident } from './ceo-conversation-incident'
import type { CeoIntent } from './ceo-cognitive-contract'
import type { CeoFailureReason } from './ceo-failure-reason'

const MEMORY_FILE = path.join(os.tmpdir(), 'agent007-persistent-memory.json')
const MEMORY_TTL_MS = Infinity

interface MemoryEntry {
  key: string
  value: string
  category: string
  createdAt: number
  score: number
  timesRecalled: number
}

let _fileCache: MemoryEntry[] | null = null
let _fileCacheAt = 0
const FILE_CACHE_TTL = 30 * 1000

function sanitizeEntry(entry: MemoryEntry): MemoryEntry {
  const fields = sanitizeMemoryFields({
    key: entry.key,
    value: entry.value,
    category: entry.category,
  })
  return { ...entry, ...fields }
}

function loadFromFile(): MemoryEntry[] {
  if (_fileCache && Date.now() - _fileCacheAt < FILE_CACHE_TTL) return _fileCache
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      const raw = fs.readFileSync(MEMORY_FILE, 'utf-8')
      const parsed = JSON.parse(raw)
      _fileCache = Array.isArray(parsed) ? parsed.map(sanitizeEntry) : []
      _fileCacheAt = Date.now()
      return _fileCache
    }
  } catch {}
  _fileCache = []
  _fileCacheAt = Date.now()
  return _fileCache
}

function saveToFile(entries: MemoryEntry[]): void {
  try {
    const safeEntries = entries.map(sanitizeEntry)
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(safeEntries, null, 2))
    _fileCache = safeEntries
    _fileCacheAt = Date.now()
  } catch {}
}

/**
 * Store a memory persistently (file + DB).
 * All text is sanitized before either persistence path receives it.
 */
export async function storePersistentMemory(
  key: string,
  value: string,
  category: string = 'general',
  score: number = 50
): Promise<void> {
  const safeFields = sanitizeMemoryFields({ key, value, category })
  const entry: MemoryEntry = {
    ...safeFields,
    createdAt: Date.now(),
    score: Math.max(0, Math.min(100, score)),
    timesRecalled: 0,
  }

  const entries = loadFromFile()
  const existingIdx = entries.findIndex((e) => e.key === entry.key)
  if (existingIdx >= 0) {
    entries[existingIdx] = entry
  } else {
    entries.push(entry)
  }
  saveToFile(entries)

  try {
    await db.memory.upsert({
      where: { key: entry.key },
      create: { key: entry.key, value: entry.value, category: entry.category },
      update: { value: entry.value, category: entry.category },
    }).catch(() => {})
  } catch {}
}

export async function recallPersistentMemory(
  query: string,
  limit: number = 5
): Promise<MemoryEntry[]> {
  const queryLower = sanitizeMemoryText(query).toLowerCase()
  const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 2)
  const safeLimit = Math.max(0, Math.min(100, Math.floor(limit)))

  const fileEntries = loadFromFile()

  let dbEntries: MemoryEntry[] = []
  try {
    const dbMems = await db.memory.findMany({ take: 100 }).catch(() => [])
    dbEntries = dbMems.map((m) => sanitizeEntry({
      key: m.key,
      value: m.value,
      category: m.category,
      createdAt: m.createdAt.getTime(),
      score: 50,
      timesRecalled: 0,
    }))
  } catch {}

  const merged = new Map<string, MemoryEntry>()
  for (const e of dbEntries) merged.set(e.key, e)
  for (const e of fileEntries) merged.set(e.key, e)

  const scored = Array.from(merged.values())
    .filter((e) => {
      if (Date.now() - e.createdAt > MEMORY_TTL_MS) return false
      const text = `${e.key} ${e.value} ${e.category}`.toLowerCase()
      return queryWords.length === 0 || queryWords.some((w) => text.includes(w))
    })
    .map((e) => {
      let relevance = 0
      for (const w of queryWords) {
        if (e.key.toLowerCase().includes(w)) relevance += 3
        if (e.value.toLowerCase().includes(w)) relevance += 2
        if (e.category.toLowerCase().includes(w)) relevance += 1
      }
      const decayFactor = 1
      return { ...e, relevance, finalScore: e.score * decayFactor + relevance * 10 }
    })
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, safeLimit)

  for (const e of scored) e.timesRecalled++
  if (scored.length > 0) saveToFile(fileEntries)

  return scored
}

export async function updateMemoryScore(key: string, success: boolean): Promise<void> {
  const entries = loadFromFile()
  const safeKey = sanitizeMemoryText(key)
  const entry = entries.find((e) => e.key === safeKey)
  if (entry) {
    entry.score = Math.max(0, Math.min(100, entry.score + (success ? 10 : -10)))
    saveToFile(entries)
  }
}

/**
 * Get all persistent memories (for backup/debugging/team-performance).
 * DB reads remain best-effort; malformed rows cannot take down this path.
 */
export async function getAllPersistentMemory(): Promise<MemoryEntry[]> {
  const fileEntries = loadFromFile()

  let dbEntries: MemoryEntry[] = []
  try {
    const dbMems = await db.memory.findMany({ take: 500 }).catch(() => [])
    dbEntries = dbMems.map((m) => sanitizeEntry({
      key: m.key,
      value: m.value,
      category: m.category,
      createdAt: m.createdAt.getTime(),
      score: 50,
      timesRecalled: 0,
    }))
  } catch {}

  const merged = new Map<string, MemoryEntry>()
  for (const e of dbEntries) merged.set(e.key, e)
  for (const e of fileEntries) merged.set(e.key, e)

  return Array.from(merged.values())
}

/**
 * Convert a conversational degradation into a stable, privacy-preserving
 * regression signal. The full user text is deliberately not persisted here.
 */
export function recordConversationDegradation(input: { objective: string; intent: CeoIntent; failureReason: CeoFailureReason }): void {
  if (input.intent !== 'conversation' && input.intent !== 'opinion') return
  emitConversationIncident(input)
}
