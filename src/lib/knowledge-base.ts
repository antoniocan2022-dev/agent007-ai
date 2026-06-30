import { db } from '@/lib/db'

/**
 * Knowledge Base / RAG helpers.
 *
 * Since SQLite doesn't support pgvector, we use a simple keyword-based
 * search approach:
 *   1. On upload: extract text, split into ~500-char chunks, tokenize
 *      each chunk into keywords (lowercased, deduped, stopwords removed)
 *   2. On search: tokenize the query, find chunks whose keywords overlap
 *      the most, return top-K ranked by overlap count.
 *
 * This is "poor man's RAG" — no embeddings, but it works for personal
 * knowledge bases up to a few thousand chunks. For production scale,
 * swap to pgvector + a real embedding model.
 */

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be',
  'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
  'would', 'should', 'could', 'may', 'might', 'must', 'can', 'this',
  'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they',
  'what', 'which', 'who', 'when', 'where', 'why', 'how', 'all', 'each',
  'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
  'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 's',
  't', 'just', 'don', 'now', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
  'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after',
  'above', 'below', 'up', 'down', 'out', 'if', 'about', 'against',
  'between', 'into', 'through', 'during', 'before', 'after', 'above',
  'below', 'from', 'up', 'down', 'in', 'out', 'on', 'off', 'over',
  'under', 'again', 'further', 'then', 'once',
])

const CHUNK_SIZE = 500
const CHUNK_OVERLAP = 50

export function tokenize(text: string): string[] {
  const lower = text.toLowerCase()
  const matches = lower.match(/[a-z0-9]+/g) || []
  const tokens: string[] = []
  for (const m of matches) {
    if (m.length >= 2 && m.length <= 50 && !STOP_WORDS.has(m) && !/^\d+$/.test(m)) {
      tokens.push(m)
    }
  }
  return [...new Set(tokens)] // dedupe
}

export function chunkText(text: string): string[] {
  if (!text) return []
  const chunks: string[] = []
  let i = 0
  while (i < text.length) {
    const end = Math.min(text.length, i + CHUNK_SIZE)
    let chunk = text.slice(i, end)
    // Try to break at a word boundary near the end
    if (end < text.length) {
      const lastSpace = chunk.lastIndexOf(' ')
      if (lastSpace > CHUNK_SIZE * 0.5) {
        chunk = chunk.slice(0, lastSpace)
        i += lastSpace + 1
      } else {
        i += CHUNK_SIZE - CHUNK_OVERLAP
      }
    } else {
      i = end
    }
    chunks.push(chunk.trim())
    if (chunks.length >= 500) break // hard cap to avoid runaway chunking
  }
  return chunks.filter((c) => c.length > 20)
}

export async function indexDocument(
  userId: string,
  docId: string,
  text: string
): Promise<number> {
  const chunks = chunkText(text)
  if (chunks.length === 0) return 0

  // Insert all chunks
  for (let i = 0; i < chunks.length; i++) {
    const content = chunks[i]
    const keywords = tokenize(content).join(',')
    await db.knowledgeChunk.create({
      data: {
        docId,
        userId,
        content,
        chunkIndex: i,
        keywords,
      },
    })
  }

  // Update the doc's chunk count
  await db.knowledgeDoc.update({
    where: { id: docId },
    data: { chunkCount: chunks.length },
  })

  return chunks.length
}

export interface KbSearchResult {
  docId: string
  filename: string
  chunkIndex: number
  content: string
  score: number
}

/**
 * Search the user's knowledge base for chunks matching the query.
 * Returns top-K results ranked by keyword overlap.
 */
export async function searchKnowledgeBase(
  userId: string,
  query: string,
  limit: number = 5
): Promise<KbSearchResult[]> {
  const queryTokens = new Set(tokenize(query))
  if (queryTokens.size === 0) return []

  // Build a LIKE query for any of the tokens
  // We fetch chunks that contain at least one query token, then rank in JS
  const tokenArray = Array.from(queryTokens)
  const likeConditions = tokenArray.map((t) => ({
    keywords: { contains: t },
  }))

  const candidates = await db.knowledgeChunk.findMany({
    where: {
      userId,
      OR: likeConditions,
    },
    take: 200, // pre-filter to top 200 candidates
    select: {
      id: true,
      docId: true,
      userId: true,
      content: true,
      chunkIndex: true,
      keywords: true,
      createdAt: true,
    },
  })

  // Score each candidate by counting keyword overlaps
  const scored = candidates.map((c: any) => {
    const chunkTokens = new Set(c.keywords.split(',').filter(Boolean))
    let score = 0
    for (const qt of queryTokens) {
      if (chunkTokens.has(qt)) score++
    }
    return { ...c, score }
  })

  // Sort by score desc, take top K
  scored.sort((a, b) => b.score - a.score)
  const topK = scored.slice(0, limit)

  // Fetch doc filenames
  const docIds = [...new Set(topK.map((c: any) => c.docId))]
  const docs = await db.knowledgeDoc.findMany({
    where: { id: { in: docIds } },
    select: { id: true, filename: true },
  })
  const docMap = new Map(docs.map((d) => [d.id, d.filename]))

  return topK.map((c: any) => ({
    docId: c.docId,
    filename: docMap.get(c.docId) || 'unknown',
    chunkIndex: c.chunkIndex,
    content: c.content,
    score: c.score,
  }))
}

/**
 * Format KB search results as a context string for the LLM.
 */
export function formatKbContext(results: KbSearchResult[]): string {
  if (results.length === 0) return ''
  return results
    .map(
      (r, i) =>
        `[${i + 1}] (from ${r.filename}, score ${r.score})\n${r.content}`
    )
    .join('\n\n---\n\n')
}
