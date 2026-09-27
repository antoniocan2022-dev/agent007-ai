// Item 1 of the "make Agent007 feel like Claude" plan: memory retrieval today (ceo-context-composer.ts's
// rankMemories) is purely lexical -- token-set overlap between the current message and a stored memory's
// text. Two genuinely related concepts with different vocabulary ("I want to build a company that can
// eventually replace my salary" / "How are we doing against my financial independence objective?") share
// no tokens and can never connect. This adds a semantic signal to blend alongside the existing lexical
// one -- it does not replace lexical matching, which stays a real, cheap, high-precision signal worth
// keeping (an exact term match is strong evidence on its own).
//
// Deliberately fail-safe: every function here degrades to returning null/0 rather than throwing, on any
// failure (no MISTRAL_API_KEY configured, network error, timeout, malformed response). Memory ranking
// must never be blocked, slowed to a crawl, or broken by an external embeddings call -- it falls back to
// exactly today's lexical-only behavior whenever the embeddings path isn't available or fails, and never
// worse than that baseline.
//
// Uses Mistral's embeddings endpoint (https://api.mistral.ai/v1/embeddings, model mistral-embed) under
// the same MISTRAL_API_KEY already configured for this project's chat provider -- no new external
// dependency or API key to provision.

const MISTRAL_EMBEDDINGS_URL = 'https://api.mistral.ai/v1/embeddings'
const EMBEDDING_MODEL = 'mistral-embed'
const EMBEDDING_TIMEOUT_MS = 5000
const EMBEDDING_CACHE_TTL_MS = 24 * 60 * 60 * 1000 // embeddings for identical text never change; long TTL is safe
const MAX_EMBEDDING_INPUT_CHARS = 8000

interface EmbeddingCacheEntry { at: number; vector: number[] }
const _embeddingCache = new Map<string, EmbeddingCacheEntry>()

function cacheKeyFor(text: string): string {
  return text.trim().toLowerCase().slice(0, MAX_EMBEDDING_INPUT_CHARS)
}

function readCache(key: string): number[] | null {
  const entry = _embeddingCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.at > EMBEDDING_CACHE_TTL_MS) { _embeddingCache.delete(key); return null }
  return entry.vector
}

function writeCache(key: string, vector: number[]): void {
  _embeddingCache.set(key, { at: Date.now(), vector })
  // Simple unbounded-growth guard: this cache lives only for the lifetime of one serverless instance,
  // but a very long-running instance under varied traffic shouldn't accumulate indefinitely.
  if (_embeddingCache.size > 2000) {
    const oldestKey = _embeddingCache.keys().next().value
    if (oldestKey !== undefined) _embeddingCache.delete(oldestKey)
  }
}

interface MistralEmbeddingResponse { data?: Array<{ embedding?: unknown }> }

/**
 * Fetches (or returns a cached) embedding vector for the given text. Returns null on any failure --
 * missing API key, network error, timeout, or a response that doesn't have the expected shape. Callers
 * must treat null as "semantic signal unavailable for this call" and fall back to lexical-only scoring,
 * never as an error to surface to the user.
 */
export async function getMemoryEmbedding(text: string, signal?: AbortSignal): Promise<number[] | null> {
  const trimmed = text.trim()
  if (!trimmed) return null
  const apiKey = process.env.MISTRAL_API_KEY?.trim()
  if (!apiKey) return null
  const key = cacheKeyFor(trimmed)
  const cached = readCache(key)
  if (cached) return cached
  try {
    const response = await fetch(MISTRAL_EMBEDDINGS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: [trimmed.slice(0, MAX_EMBEDDING_INPUT_CHARS)] }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(EMBEDDING_TIMEOUT_MS)]) : AbortSignal.timeout(EMBEDDING_TIMEOUT_MS),
    })
    if (!response.ok) return null
    const payload = (await response.json()) as MistralEmbeddingResponse
    const vector = payload.data?.[0]?.embedding
    if (!Array.isArray(vector) || vector.length === 0 || !vector.every((value) => typeof value === 'number')) return null
    writeCache(key, vector)
    return vector
  } catch {
    return null
  }
}

/**
 * Parses a Memory row's stored `embedding` column (JSON-encoded float array) back into a vector.
 * Defensively validates shape exactly like getMemoryEmbedding's own response parsing -- a malformed or
 * corrupted stored value (should never happen, but this is read from durable storage, not a fresh API
 * response) returns null rather than throwing, so a caller can fall back to a live embedding call.
 */
export function parseStoredMemoryEmbedding(value: string | null | undefined): number[] | null {
  if (!value) return null
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((entry) => typeof entry === 'number')) return null
    return parsed
  } catch {
    return null
  }
}

/** Standard cosine similarity, defensively returning 0 for empty or mismatched-length vectors rather than throwing. */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0
  let dot = 0, normA = 0, normB = 0
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index]! * b[index]!
    normA += a[index]! * a[index]!
    normB += b[index]! * b[index]!
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

/**
 * The minimum cosine similarity treated as genuine relatedness rather than noise -- cosine similarity
 * between two unrelated short texts is rarely a clean 0, so a low positive value on its own isn't a
 * real signal. Exported so ceo-context-composer.ts's integration and its tests share one number.
 */
export const SEMANTIC_RELEVANCE_THRESHOLD = 0.55

// "Next architecture" program, Stage 3: memories written under one of these categories are the only
// ones recoverSemanticMemories (ceo-context-composer.ts) ever reads -- filterConversationalMemories's
// fail-closed allowlist excludes everything else before ranking runs. Embedding a memory outside this
// set would be pure wasted work: computed at write time, never read at query time. Kept as a literal
// copy of ceo-memory-visibility.ts's own allowlist rather than importing it, so this module (used from
// low-level write paths like memory.ts/persistent-memory.ts) never has to depend on the visibility
// module's own import chain; ceo-memory-visibility.test.ts pins both lists to the same values.
const EMBEDDABLE_MEMORY_CATEGORIES = new Set(['general', 'mission', 'strategy', 'user_goal', 'decision'])

/**
 * Computes the embedding to store on a Memory row at write time, so read-time semantic recall
 * (recoverSemanticMemories) can compare against a stored vector instead of calling the embeddings API
 * live for every zero-lexical-overlap candidate on every turn. Uses the exact same text shape
 * (`${key}: ${value}`) recoverSemanticMemories already uses for its own live per-candidate calls, so
 * cosine similarity against a live-computed query embedding stays meaningful once this is stored.
 * Returns undefined (never throws) whenever embedding isn't worthwhile or possible: a non-visible
 * category (nothing would ever read it), no API key configured, or the call fails -- callers write
 * `embedding: undefined` in that case, which Prisma treats as "leave/set null", never blocking the
 * memory write itself.
 */
export async function computeMemoryEmbeddingField(key: string, value: string, category: string, signal?: AbortSignal): Promise<string | undefined> {
  if (!EMBEDDABLE_MEMORY_CATEGORIES.has(category.trim().toLowerCase())) return undefined
  const vector = await getMemoryEmbedding(`${key}: ${value}`, signal)
  return vector ? JSON.stringify(vector) : undefined
}
