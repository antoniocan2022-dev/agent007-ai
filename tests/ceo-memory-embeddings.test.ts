import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { SEMANTIC_RELEVANCE_THRESHOLD, cosineSimilarity, getMemoryEmbedding, computeMemoryEmbeddingField, parseStoredMemoryEmbedding } from '@/lib/ceo-memory-embeddings'

describe('cosineSimilarity: pure math, defensive on bad input', () => {
  test('identical vectors score 1', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 5)
  })
  test('orthogonal vectors score 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5)
  })
  test('opposite vectors score -1', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 5)
  })
  test('a known non-trivial case', () => {
    // cos similarity of [1,2,3] and [4,5,6] = 32 / (sqrt(14)*sqrt(77)) ~= 0.9746
    expect(cosineSimilarity([1, 2, 3], [4, 5, 6])).toBeCloseTo(0.9746, 3)
  })
  test('empty vectors return 0, not NaN or a thrown error', () => {
    expect(cosineSimilarity([], [])).toBe(0)
    expect(cosineSimilarity([1, 2], [])).toBe(0)
  })
  test('mismatched-length vectors return 0 rather than throwing', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0)
  })
  test('a zero vector returns 0 rather than dividing by zero into NaN', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0)
  })
})

describe('SEMANTIC_RELEVANCE_THRESHOLD', () => {
  test('is a real, non-trivial similarity floor -- not 0 (which would treat noise as signal) and not close to 1 (which would recover almost nothing)', () => {
    expect(SEMANTIC_RELEVANCE_THRESHOLD).toBeGreaterThan(0.3)
    expect(SEMANTIC_RELEVANCE_THRESHOLD).toBeLessThan(0.8)
  })
})

describe('getMemoryEmbedding: fails safe to null, never throws, never makes a network call without a key', () => {
  const originalKey = process.env.MISTRAL_API_KEY
  beforeEach(() => { delete process.env.MISTRAL_API_KEY })
  afterEach(() => { if (originalKey !== undefined) process.env.MISTRAL_API_KEY = originalKey })

  test('returns null immediately when MISTRAL_API_KEY is not configured -- exactly this sandbox\'s and possibly production\'s current state', async () => {
    const result = await getMemoryEmbedding('financial independence objective')
    expect(result).toBeNull()
  })

  test('returns null for empty/whitespace-only text without attempting a call', async () => {
    expect(await getMemoryEmbedding('')).toBeNull()
    expect(await getMemoryEmbedding('   ')).toBeNull()
  })

  test('never throws even when called repeatedly with no key configured', async () => {
    const results = await Promise.all([
      getMemoryEmbedding('a'),
      getMemoryEmbedding('b'),
      getMemoryEmbedding('c'),
    ])
    expect(results).toEqual([null, null, null])
  })
})

describe('parseStoredMemoryEmbedding: defensive parsing of the Memory.embedding column', () => {
  test('parses a valid JSON float array', () => {
    expect(parseStoredMemoryEmbedding(JSON.stringify([0.1, 0.2, 0.3]))).toEqual([0.1, 0.2, 0.3])
  })
  test('returns null for null/undefined/empty input', () => {
    expect(parseStoredMemoryEmbedding(null)).toBeNull()
    expect(parseStoredMemoryEmbedding(undefined)).toBeNull()
    expect(parseStoredMemoryEmbedding('')).toBeNull()
  })
  test('returns null for malformed JSON rather than throwing', () => {
    expect(parseStoredMemoryEmbedding('{not valid json')).toBeNull()
  })
  test('returns null for valid JSON that is not a non-empty number array', () => {
    expect(parseStoredMemoryEmbedding('[]')).toBeNull()
    expect(parseStoredMemoryEmbedding('"a string"')).toBeNull()
    expect(parseStoredMemoryEmbedding('[1, "two", 3]')).toBeNull()
    expect(parseStoredMemoryEmbedding('{"a":1}')).toBeNull()
  })
})

describe('computeMemoryEmbeddingField: write-time embedding, scoped to conversationally-visible categories', () => {
  const originalKey = process.env.MISTRAL_API_KEY
  beforeEach(() => { process.env.MISTRAL_API_KEY = 'test-key' })
  afterEach(() => { if (originalKey !== undefined) process.env.MISTRAL_API_KEY = originalKey; else delete process.env.MISTRAL_API_KEY })

  test('returns undefined without attempting any embedding call for a non-visible category', async () => {
    // 'preference' is a real category memory.ts's own MemoryCategory type uses, but it is not in
    // ceo-memory-visibility.ts's CONVERSATIONAL_VISIBLE_CATEGORIES allowlist -- rankMemories never
    // reads it, so embedding it would be pure wasted work.
    const result = await computeMemoryEmbeddingField('key1', 'some value', 'preference')
    expect(result).toBeUndefined()
  })

  test('returns undefined (fails safe) for a visible category when no API key is configured', async () => {
    delete process.env.MISTRAL_API_KEY
    const result = await computeMemoryEmbeddingField('key1', 'some value', 'general')
    expect(result).toBeUndefined()
  })

  test('never throws for any of the other conversationally-visible categories', async () => {
    delete process.env.MISTRAL_API_KEY
    for (const category of ['mission', 'strategy', 'user_goal', 'decision']) {
      expect(await computeMemoryEmbeddingField('key1', 'some value', category)).toBeUndefined()
    }
  })

  test('a visible category actually attempts the embeddings call; a non-visible one never does', async () => {
    let callCount = 0
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => {
      callCount += 1
      return new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }), { status: 200 })
    }) as typeof fetch
    try {
      const nonVisible = await computeMemoryEmbeddingField('key1', 'some value', 'preference')
      expect(nonVisible).toBeUndefined()
      expect(callCount).toBe(0)
      const visible = await computeMemoryEmbeddingField('key2', 'some other value', 'general')
      expect(visible).toBe(JSON.stringify([0.1, 0.2, 0.3]))
      expect(callCount).toBe(1)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
