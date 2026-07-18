/**
 * /api/tools/repair — UPGRADE #93
 * Self-repair endpoint: audit, test, fix, recover, restore all tools.
 */
import { NextRequest, NextResponse } from 'next/server'
import { toolSelfHealingLoop, toolRegistryAuditor, toolBatchTester, toolFixer, toolSubagentToolAuditor, toolSubagentToolFixer } from '@/lib/tool-self-repair-engine'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const action = url.searchParams.get('action') ?? 'status'

  if (action === 'status') {
    const audit = await toolRegistryAuditor({ action: 'audit' })
    const subagents = await toolSubagentToolAuditor({ action: 'audit_all' })
    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      audit: { preview: audit.preview, result: audit.result },
      subagents: { preview: subagents.preview, result: subagents.result },
    })
  }

  if (action === 'audit') {
    const r = await toolRegistryAuditor({ action: 'audit' })
    return NextResponse.json({ ok: r.ok, preview: r.preview, result: r.result })
  }

  if (action === 'subagents') {
    const r = await toolSubagentToolAuditor({ action: 'audit_all' })
    return NextResponse.json({ ok: r.ok, preview: r.preview, result: r.result })
  }

  return NextResponse.json({ ok: false, error: 'Unknown action. Use: status | audit | subagents' }, { status: 400 })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { action = 'self_heal' } = body

  if (action === 'self_heal') {
    const r = await toolSelfHealingLoop({ action: 'run' })
    return NextResponse.json({ ok: r.ok, preview: r.preview, result: r.result })
  }

  if (action === 'fix_all') {
    const r = await toolFixer({ action: 'fix_all' })
    return NextResponse.json({ ok: r.ok, preview: r.preview, result: r.result })
  }

  if (action === 'fix_subagents') {
    const r = await toolSubagentToolFixer({ action: 'fix_all' })
    return NextResponse.json({ ok: r.ok, preview: r.preview, result: r.result })
  }

  if (action === 'batch_test') {
    const r = await toolBatchTester({ action: 'test_filtered', filter: body.filter ?? 'real', max_tools: body.max_tools ?? 20 })
    return NextResponse.json({ ok: r.ok, preview: r.preview, result: r.result })
  }

  return NextResponse.json({ ok: false, error: 'Unknown action. Use: self_heal | fix_all | fix_subagents | batch_test' }, { status: 400 })
}
