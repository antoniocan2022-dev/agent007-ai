/**
 * /api/system/org-policies — UPGRADE #226
 *
 * Organizational Policies endpoint.
 *
 * GET /api/system/org-policies → list all 3 policies
 * POST /api/system/org-policies/check → check a mission plan against policies
 *   Body: { missionGoal, proposedLeaders, hasDebate, isFinancial, riskScore, hasMemoryRetry, hasWebSearchFirst }
 */
import { NextRequest, NextResponse } from 'next/server'
import { getOrgPolicies, checkPolicies, type PolicyContext } from '@/lib/evolution-engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const policies = getOrgPolicies()
  return NextResponse.json({
    ok: true,
    count: policies.length,
    policies: policies.map(p => ({
      id: p.id,
      name: p.name,
      rule: p.rule,
      description: p.description,
      enforcement: p.enforcement,
    })),
  })
}

export async function POST(req: NextRequest) {
  let body: any
  try { body = await req.json() }
  catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }) }

  const ctx: PolicyContext = {
    missionGoal: body?.missionGoal || '',
    proposedLeaders: body?.proposedLeaders || [],
    hasDebate: body?.hasDebate ?? false,
    isFinancial: body?.isFinancial ?? false,
    riskScore: body?.riskScore ?? 0,
    hasMemoryRetry: body?.hasMemoryRetry ?? false,
    hasWebSearchFirst: body?.hasWebSearchFirst ?? false,
  }

  const violations = checkPolicies(ctx)
  const hasBlockingViolation = violations.some(v => v.enforcement === 'block')

  return NextResponse.json({
    ok: !hasBlockingViolation,
    passed: violations.length === 0,
    violationCount: violations.length,
    violations,
    hasBlockingViolation,
  })
}
