import { NextResponse } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'
import { getFullAccessTools } from '@/lib/subagents'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/system/fix-agents
 * Fixes all custom subagents in the DB to have FULL_ACCESS_TOOLS (all 588+ tools).
 *
 * UPGRADE #83: The Content Specialist + Performance Analyst agents were created
 * with only 2 tools in their allowedTools field. At runtime, getAllSubagents()
 * overrides this with FULL_ACCESS_TOOLS — but the DB rows still show 2 tools.
 * This endpoint permanently updates the DB rows to reflect FULL_ACCESS.
 */
export async function GET() {
  await ensureDbReady().catch(() => {})

  try {
    const allTools = getFullAccessTools()
    const toolsJson = JSON.stringify(allTools)

    // Find all custom subagents (not builtin overlays)
    const customAgents = await db.customSubagent.findMany({
      where: { isBuiltinOverlay: false },
    })

    const results: any[] = []
    for (const agent of customAgents) {
      const currentTools = JSON.parse(agent.allowedTools || '[]')
      const updated = await db.customSubagent.update({
        where: { id: agent.id },
        data: {
          allowedTools: toolsJson,
          enabled: true,
        },
      })
      results.push({
        id: agent.id,
        name: agent.name,
        before: `${currentTools.length} tools`,
        after: `${allTools.length} tools (FULL_ACCESS)`,
        enabled: updated.enabled,
      })
    }

    // Also fix builtin overlays if any exist
    const overlays = await db.customSubagent.findMany({
      where: { isBuiltinOverlay: true },
    })
    for (const overlay of overlays) {
      const currentTools = JSON.parse(overlay.allowedTools || '[]')
      if (currentTools.length < allTools.length) {
        await db.customSubagent.update({
          where: { id: overlay.id },
          data: { allowedTools: toolsJson },
        })
        results.push({
          id: overlay.id,
          name: overlay.name,
          before: `${currentTools.length} tools`,
          after: `${allTools.length} tools (FULL_ACCESS)`,
          enabled: overlay.enabled,
          note: 'builtin overlay updated',
        })
      }
    }

    return NextResponse.json({
      ok: true,
      message: `Fixed ${results.length} agents to FULL_ACCESS (${allTools.length} tools each)`,
      totalTools: allTools.length,
      fixed: results,
    })
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? 'Failed to fix agents' },
      { status: 500 }
    )
  }
}
