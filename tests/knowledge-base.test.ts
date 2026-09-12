import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { db } from '../src/lib/db'
import { chunkText, indexDocument, searchKnowledgeBase, tokenize } from '../src/lib/knowledge-base'

describe('tokenize', () => {
  test('lowercases, dedupes, strips stopwords and pure numbers', () => {
    const tokens = tokenize('The Revenue Revenue grew 42 percent in Q3 2026, and 2026 was great.')
    expect(tokens).toContain('revenue')
    expect(tokens).toContain('percent')
    expect(tokens.filter((t) => t === 'revenue').length).toBe(1)
    expect(tokens).not.toContain('the')
    expect(tokens).not.toContain('and')
    expect(tokens).not.toContain('42')
    expect(tokens).not.toContain('2026')
  })

  test('drops tokens shorter than 2 chars or longer than 50', () => {
    const tokens = tokenize(`a bb ${'c'.repeat(51)} runway`)
    expect(tokens).not.toContain('a')
    expect(tokens).toContain('bb')
    expect(tokens).not.toContain('c'.repeat(51))
    expect(tokens).toContain('runway')
  })
})

describe('chunkText', () => {
  test('returns no chunks for empty input', () => {
    expect(chunkText('')).toEqual([])
  })

  test('breaks long text into multiple chunks, preferring word boundaries', () => {
    const text = Array.from({ length: 30 }, (_, i) => `sentence number ${i} about the business plan`).join('. ')
    const chunks = chunkText(text)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(500)
  })

  test('drops trivially short trailing fragments (<=20 chars)', () => {
    const chunks = chunkText('short')
    expect(chunks).toEqual([])
  })
})

describe('knowledge base indexing and search (real database)', () => {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const userId = `ci-kb-user-${suffix}`
  const docIds: string[] = []

  beforeAll(() => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for knowledge base integration tests.')
  })

  afterAll(async () => {
    for (const docId of docIds) {
      await db.knowledgeChunk.deleteMany({ where: { docId } }).catch(() => {})
      await db.knowledgeDoc.deleteMany({ where: { id: docId } }).catch(() => {})
    }
  })

  test('indexDocument stores chunks with an empty embedding array when no embeddings provider is configured, and keyword search still finds them', async () => {
    const savedKey = process.env.MISTRAL_API_KEY
    delete process.env.MISTRAL_API_KEY
    try {
      const doc = await db.knowledgeDoc.create({ data: { userId, filename: 'runway-plan.txt', mimeType: 'text/plain', size: 100, text: 'placeholder', chunkCount: 0 } })
      docIds.push(doc.id)
      const text = 'Our current runway extends for fourteen months given the present burn rate and committed revenue pipeline.'
      const chunkCount = await indexDocument(userId, doc.id, text)
      expect(chunkCount).toBeGreaterThan(0)

      const storedChunks = await db.knowledgeChunk.findMany({ where: { docId: doc.id } })
      expect(storedChunks.length).toBe(chunkCount)
      // Post-merge audit fix context: every chunk fails closed to an empty embedding array (never
      // null, never a fabricated vector) when MISTRAL_API_KEY isn't configured -- exactly the shape
      // recoverSemanticChunks's `embedding: { isEmpty: false }` filter relies on to skip them.
      for (const chunk of storedChunks) expect(chunk.embedding).toEqual([])

      const results = await searchKnowledgeBase(userId, 'runway burn rate', 5)
      expect(results.some((r) => r.docId === doc.id)).toBe(true)
    } finally {
      if (savedKey !== undefined) process.env.MISTRAL_API_KEY = savedKey
    }
  })

  test('searchKnowledgeBase returns no results for a query with no real tokens', async () => {
    const results = await searchKnowledgeBase(userId, '   ', 5)
    expect(results).toEqual([])
  })

  test('searchKnowledgeBase scopes results to the requesting user only', async () => {
    const otherUserId = `ci-kb-other-${suffix}`
    const doc = await db.knowledgeDoc.create({ data: { userId: otherUserId, filename: 'other-user-doc.txt', mimeType: 'text/plain', size: 100, text: 'placeholder', chunkCount: 0 } })
    try {
      await indexDocument(otherUserId, doc.id, 'This document mentions a very distinctive term xylophonequartz for testing scoping.')
      const resultsForOwner = await searchKnowledgeBase(otherUserId, 'xylophonequartz', 5)
      expect(resultsForOwner.length).toBeGreaterThan(0)
      const resultsForOtherUser = await searchKnowledgeBase(userId, 'xylophonequartz', 5)
      expect(resultsForOtherUser).toEqual([])
    } finally {
      await db.knowledgeChunk.deleteMany({ where: { docId: doc.id } }).catch(() => {})
      await db.knowledgeDoc.deleteMany({ where: { id: doc.id } }).catch(() => {})
    }
  })
})
