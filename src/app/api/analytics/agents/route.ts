import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/analytics/agents
 *
 * Returns per-agent usage analytics computed from the Message table:
 *   - dispatchCount: how many times this agent was dispatched
 *   - toolCallCount: how many tool calls this agent made
 *   - lastUsedAt: most recent activity
 *   - firstUsedAt: first activity
 *   - successRate: % of dispatches that completed without error
 *   - avgToolCallsPerDispatch: efficiency metric
 *
 * Also returns global stats: total conversations, total dispatches, total
 * tool calls, most-used agent, least-used agent.
 */
export async function GET() {
  // Get all subagent-related messages
  const [dispatches, subToolCalls, completes] = await Promise.all([
    db.message.findMany({
      where: { toolName: 'subagent_dispatch' },
      select: { toolArgs: true, toolResult: true, createdAt: true },
    }),
    db.message.findMany({
      where: { toolName: 'subagent_tool' },
      select: { toolArgs: true, toolResult: true, createdAt: true },
    }),
    db.message.findMany({
      where: { toolName: 'subagent_complete' },
      select: { toolArgs: true, toolResult: true, createdAt: true },
    }),
  ])

  // Build per-agent stats
  const agentStats: Record<string, {
    name: string
    dispatchCount: number
    toolCallCount: number
    completeCount: number
    errorCount: number
    lastUsedAt: Date | null
    firstUsedAt: Date | null
  }> = {}

  function ensureAgent(id: string, name: string) {
    if (!agentStats[id]) {
      agentStats[id] = {
        name,
        dispatchCount: 0,
        toolCallCount: 0,
        completeCount: 0,
        errorCount: 0,
        lastUsedAt: null,
        firstUsedAt: null,
      }
    }
  }

  function updateTime(id: string, ts: Date) {
    if (!agentStats[id]) return
    if (!agentStats[id].firstUsedAt || ts < agentStats[id].firstUsedAt) agentStats[id].firstUsedAt = ts
    if (!agentStats[id].lastUsedAt || ts > agentStats[id].lastUsedAt) agentStats[id].lastUsedAt = ts
  }

  for (const d of dispatches) {
    try {
      const args = JSON.parse(d.toolArgs)
      const id = args.agentId || args.agentName || 'unknown'
      const name = args.agentName || args.agentId || 'Unknown'
      ensureAgent(id, name)
      agentStats[id].dispatchCount++
      const isError = d.toolResult?.includes('ERROR') || d.toolResult?.includes('Unknown sub-agent')
      if (isError) agentStats[id].errorCount++
      updateTime(id, d.createdAt)
    } catch {}
  }

  for (const t of subToolCalls) {
    try {
      const args = JSON.parse(t.toolArgs)
      const id = args.agentId || 'unknown'
      ensureAgent(id, id)
      agentStats[id].toolCallCount++
      const isError = t.toolResult?.toLowerCase().includes('failed') || t.toolResult?.toLowerCase().includes('error')
      if (isError) agentStats[id].errorCount++
      updateTime(id, t.createdAt)
    } catch {}
  }

  for (const c of completes) {
    try {
      const args = JSON.parse(c.toolArgs)
      const id = args.agentId || 'unknown'
      ensureAgent(id, id)
      agentStats[id].completeCount++
      updateTime(id, c.createdAt)
    } catch {}
  }

  // Compute derived stats
  const agents = Object.entries(agentStats).map(([id, s]) => ({
    id,
    name: s.name,
    dispatchCount: s.dispatchCount,
    toolCallCount: s.toolCallCount,
    completeCount: s.completeCount,
    errorCount: s.errorCount,
    successRate: s.dispatchCount > 0 ? Math.round(((s.dispatchCount - s.errorCount) / s.dispatchCount) * 100) : 100,
    avgToolCallsPerDispatch: s.dispatchCount > 0 ? Math.round((s.toolCallCount / s.dispatchCount) * 10) / 10 : 0,
    lastUsedAt: s.lastUsedAt,
    firstUsedAt: s.firstUsedAt,
  })).sort((a, b) => b.dispatchCount - a.dispatchCount)

  const totalDispatches = dispatches.length
  const totalToolCalls = subToolCalls.length
  const mostUsed = agents[0] || null
  const leastUsed = agents[agents.length - 1] || null

  return NextResponse.json({
    agents,
    global: {
      totalDispatches,
      totalToolCalls,
      totalAgentsUsed: agents.length,
      mostUsed: mostUsed ? { name: mostUsed.name, dispatchCount: mostUsed.dispatchCount } : null,
      leastUsed: leastUsed ? { name: leastUsed.name, dispatchCount: leastUsed.dispatchCount } : null,
    },
  })
}
