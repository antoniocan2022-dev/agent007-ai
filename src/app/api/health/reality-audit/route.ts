/**
 * /api/health/reality-audit — UPGRADE #120 (Finding 1)
 * Reports which tools are REAL vs VIRTUAL.
 *
 * GET /api/health/reality-audit
 *
 * Returns:
 *   - total tools classified
 *   - list of REAL tools (make actual API calls)
 *   - list of VIRTUAL tools (instructional / conditional without key)
 *   - percentage of tools that are real
 */
import { listVirtualTools, listRealTools, TOOL_REALITY_REGISTRY } from '@/lib/reality-gate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const realTools = listRealTools()
  const virtualTools = listVirtualTools()
  const total = realTools.length + virtualTools.length
  const realPercent = total > 0 ? Math.round((realTools.length / total) * 100) : 0

  return Response.json({
    ok: true,
    timestamp: new Date().toISOString(),
    summary: {
      totalClassified: total,
      real: realTools.length,
      virtual: virtualTools.length,
      realPercent,
      virtualPercent: 100 - realPercent,
    },
    realTools,
    virtualTools: virtualTools.map((v) => ({
      toolName: v.toolName,
      level: v.level,
      requiredEnvVar: v.requiredEnvVar || null,
      honestDescription: v.honestDescription,
      realApiUrl: v.realApiUrl || null,
      envVarSet: v.requiredEnvVar ? !!process.env[v.requiredEnvVar] : null,
    })),
    note: 'Tools not in the registry are assumed to be REAL (they make actual API calls). Only tools that have been audited and found to be VIRTUAL appear in the virtualTools list. To audit more tools, add them to TOOL_REALITY_REGISTRY in src/lib/reality-gate.ts.',
  })
}
