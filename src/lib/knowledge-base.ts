import { db } from '@/lib/db'
import { cosineSimilarity, getMemoryEmbedding, SEMANTIC_RELEVANCE_THRESHOLD } from '@/lib/ceo-memory-embeddings'

/**
 * Knowledge Base / RAG helpers.
 *
 * Retrieval blends two signals, the same way ceo-context-composer.ts's memory ranking does:
 *   1. On upload: extract text, split into ~500-char chunks, tokenize each chunk into keywords
 *      (lowercased, deduped, stopwords removed), and best-effort embed each chunk (see
 *      getMemoryEmbedding/embedChunksBestEffort below) -- an exact term match is still strong,
 *      cheap, high-precision evidence on its own and is never replaced by the semantic signal.
 *   2. On search: tokenize the query, find chunks whose keywords overlap the most (unchanged,
 *      today's behavior), then recover additional chunks via embedding cosine similarity for
 *      genuinely related content that shares no vocabulary with the query -- exactly the gap plain
 *      keyword search cannot close (e.g. a query about "runway" never keyword-matching a chunk that
 *      only says "months of cash remaining").
 *
 * There is no pgvector/ANN index here (Postgres native float arrays only) -- similarity is computed
 * in JS over a bounded candidate pool, not indexed. That is a real, working semantic signal today;
 * a proper vector index is future scaling work once real usage justifies it, not a prerequisite.
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

// Bounds how many chunks per document get an embeddings call -- keeps worst-case ingestion latency
// and embeddings-provider cost predictable even for a very large document. Chunks beyond this cap
// still get indexed and are fully searchable by keyword, just without the semantic-recovery signal.
const MAX_EMBEDDED_CHUNKS_PER_DOC = 300

export async function indexDocument(
  userId: string,
  docId: string,
  text: string
): Promise<number> {
  const chunks = chunkText(text)
  if (chunks.length === 0) return 0

  // Insert all chunks. Embeddings are computed with bounded concurrency (not one Promise.all over
  // every chunk at once) to avoid bursting the embeddings provider's rate limit on a large document;
  // failures degrade individual chunks to keyword-only (getMemoryEmbedding never throws).
  const EMBEDDING_CONCURRENCY = 5
  let nextIndex = 0
  const worker = async () => {
    while (true) {
      const i = nextIndex++
      if (i >= chunks.length) return
      const content = chunks[i]
      const keywords = tokenize(content).join(',')
      const embedding = i < MAX_EMBEDDED_CHUNKS_PER_DOC ? await getMemoryEmbedding(content).catch(() => null) : null
      await db.knowledgeChunk.create({
        data: {
          docId,
          userId,
          content,
          chunkIndex: i,
          keywords,
          embedding: embedding ?? [],
        },
      })
    }
  }
  await Promise.all(Array.from({ length: Math.min(EMBEDDING_CONCURRENCY, chunks.length) }, () => worker()))

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

// Bounds the pool of embedded chunks compared against a query when keyword matching alone doesn't
// fill the requested result count -- keeps the worst-case cost of semantic recovery predictable
// even for a user with a very large knowledge base (no vector index to narrow the pool otherwise).
const MAX_SEMANTIC_RECOVERY_POOL = 200

/**
 * Recovers chunks that share no vocabulary with the query but are semantically related to it, by
 * embedding the query and comparing against a bounded pool of already-embedded chunks. Mirrors
 * ceo-context-composer.ts's recoverSemanticMemories: fails safe to an empty array (never throws) on
 * any problem -- missing MISTRAL_API_KEY, network error, or a user with no embedded chunks yet.
 */
async function recoverSemanticChunks(
  userId: string,
  queryText: string,
  excludeIds: ReadonlySet<string>,
  limit: number
): Promise<Array<{ docId: string; chunkIndex: number; content: string; score: number }>> {
  const queryEmbedding = await getMemoryEmbedding(queryText)
  if (!queryEmbedding) return []
  const pool = await db.knowledgeChunk.findMany({
    where: { userId, embedding: { isEmpty: false } },
    take: MAX_SEMANTIC_RECOVERY_POOL,
    orderBy: { createdAt: 'desc' },
    select: { id: true, docId: true, content: true, chunkIndex: true, embedding: true },
  })
  const scored = pool
    .filter((chunk: any) => !excludeIds.has(chunk.id))
    .map((chunk: any) => ({ docId: chunk.docId, chunkIndex: chunk.chunkIndex, content: chunk.content, score: cosineSimilarity(queryEmbedding, chunk.embedding) }))
    .filter((chunk) => chunk.score >= SEMANTIC_RELEVANCE_THRESHOLD)
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit)
}

/**
 * Search the user's knowledge base for chunks matching the query.
 * Returns top-K results ranked by keyword overlap, falling back to embedding-similarity recovery
 * for genuinely related chunks when keyword matching alone doesn't fill the requested result count.
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
    return { docId: c.docId, chunkIndex: c.chunkIndex, content: c.content, score }
  })
  const lexicalMatches = scored.filter((c) => c.score > 0)

  // Only worth the embeddings round-trip when keyword matching alone hasn't already filled the
  // requested result count -- never re-ranks or displaces a real lexical match.
  const semanticMatches = lexicalMatches.length < limit
    ? await recoverSemanticChunks(userId, query, new Set(candidates.map((c: any) => c.id)), limit - lexicalMatches.length)
    : []

  // Sort by score desc, take top K. Semantic scores are bounded to [SEMANTIC_RELEVANCE_THRESHOLD, 1]
  // and lexical scores are integer keyword-overlap counts (>=1), so a real keyword match still
  // outranks a recovered chunk in virtually every case.
  const combined = [...lexicalMatches, ...semanticMatches].sort((a, b) => b.score - a.score)
  const topK = combined.slice(0, limit)

  // Fetch doc filenames
  const docIds = [...new Set(topK.map((c) => c.docId))]
  const docs = await db.knowledgeDoc.findMany({
    where: { id: { in: docIds } },
    select: { id: true, filename: true },
  })
  const docMap = new Map(docs.map((d) => [d.id, d.filename]))

  return topK.map((c) => ({
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
