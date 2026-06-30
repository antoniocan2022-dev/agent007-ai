import { NextRequest, NextResponse } from 'next/server'
import { getSessionUserId } from '@/lib/session-user'
import { searchKnowledgeBase, formatKbContext } from '@/lib/knowledge-base'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/kb/search
 * Body: { query: string, limit?: number }
 *
 * Searches the user's knowledge base for chunks matching the query.
 * Returns { results: KbSearchResult[], context: string }
 */
export async function POST(req: NextRequest) {
  const userId = await getSessionUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { query, limit } = body as { query?: string; limit?: number }
  if (!query || typeof query !== 'string') {
    return NextResponse.json({ error: 'Missing "query"' }, { status: 400 })
  }

  const results = await searchKnowledgeBase(
    userId,
    query,
    Math.min(20, Math.max(1, limit || 5))
  )

  return NextResponse.json({
    results,
    context: formatKbContext(results),
    count: results.length,
  })
}
