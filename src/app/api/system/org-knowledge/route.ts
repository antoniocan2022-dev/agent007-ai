/**
 * /api/system/org-knowledge — UPGRADE #227
 *
 * Organizational Knowledge Base endpoint.
 *
 * GET /api/system/org-knowledge → summary of all org knowledge
 * GET /api/system/org-knowledge?type=best_workflow → specific type
 * GET /api/system/org-knowledge?query=tesla → keyword search
 *
 * Types: best_workflow, worst_workflow, common_failure, common_success,
 *        leader_combination, reasoning_pattern
 */
import { NextRequest, NextResponse } from 'next/server'
import {
  getOrgKnowledge,
  getOrgKnowledgeSummary,
  queryOrgKnowledge,
  type KnowledgeType,
} from '@/lib/organizational-knowledge-base'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const type = url.searchParams.get('type') as KnowledgeType | null
  const query = url.searchParams.get('query')
  const summary = url.searchParams.get('summary') === 'true'

  if (query) {
    const results = await queryOrgKnowledge(query, 10)
    return NextResponse.json({ ok: true, query, count: results.length, results })
  }

  if (summary || (!type && !query)) {
    const s = await getOrgKnowledgeSummary()
    return NextResponse.json({ ok: true, ...s })
  }

  const entries = await getOrgKnowledge(type || undefined, 50)
  return NextResponse.json({ ok: true, type, count: entries.length, entries })
}
