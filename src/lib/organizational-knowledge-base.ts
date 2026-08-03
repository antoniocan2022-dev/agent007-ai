/**
 * organizational-knowledge-base.ts — UPGRADE #227
 *
 * Finding 3: Dedicated Organizational Memory.
 *
 * The Evolution Engine was reusing the general memory table. But
 * organizational knowledge deserves its own domain — structured,
 * queryable, and automatically maintained.
 *
 * This module maintains 6 categories of organizational knowledge:
 *   1. Best workflows (highest-confidence mission patterns)
 *   2. Worst workflows (lowest-confidence / failed patterns)
 *   3. Common failures (recurring error patterns)
 *   4. Common successes (recurring success patterns)
 *   5. Leader combinations (which leaders work well together)
 *   6. Best reasoning patterns (which cognitive styles produce best results)
 *
 * Stored in DB with category 'org_knowledge' — separate from general memory.
 */

import { db } from './db'
import type { MissionTelemetry } from './mission-telemetry'

export const runtime = 'nodejs'

// ═══════════════════════════════════════════════════════════════
// DATA MODEL
// ═══════════════════════════════════════════════════════════════

export type KnowledgeType =
  | 'best_workflow'
  | 'worst_workflow'
  | 'common_failure'
  | 'common_success'
  | 'leader_combination'
  | 'reasoning_pattern'

export interface OrgKnowledgeEntry {
  entryId: string
  type: KnowledgeType
  pattern: string           // What is the pattern? (e.g., "scout+quantum+echo")
  description: string       // Human-readable description
  confidence: number        // Average confidence when this pattern was used (0-100)
  successRate: number        // Success rate when this pattern was used (0-100)
  occurrences: number        // How many times this pattern has been seen
  lastSeen: string           // ISO timestamp
  missionIds: string[]       // Reference missions
  metadata?: Record<string, any>  // Additional structured data
}

// ═══════════════════════════════════════════════════════════════
// INGESTION: Learn from completed missions
// ═══════════════════════════════════════════════════════════════

/**
 * Ingest a completed mission's telemetry into the Organizational KB.
 * Automatically extracts and updates all 6 knowledge types.
 *
 * Called from mission-os.ts LEARN stage (after telemetry is complete).
 */
export async function ingestMission(telemetry: MissionTelemetry): Promise<void> {
  if (!telemetry || !telemetry.missionId) return

  console.log(`[org-kb] Ingesting mission ${telemetry.missionId}...`)

  // Extract the leader combination used
  const leaderCombo = telemetry.leadersUsed.slice().sort().join('+')
  if (leaderCombo) {
    await upsertKnowledgeEntry({
      type: telemetry.confidence >= 70 ? 'leader_combination' : 'leader_combination',
      pattern: leaderCombo,
      description: `Leader combination: ${leaderCombo}`,
      confidence: telemetry.confidence,
      success: telemetry.status === 'completed',
      missionId: telemetry.missionId,
      metadata: { leaders: telemetry.leadersUsed, tools: telemetry.toolsCalled.length },
    })
  }

  // Extract workflow pattern (leaders + tools)
  const workflowPattern = `${leaderCombo || 'solo'}|${telemetry.toolCallCount}tools|${telemetry.debateTriggered ? 'debate' : 'nodebate'}`
  await upsertKnowledgeEntry({
    type: telemetry.confidence >= 70 && telemetry.verificationPassed ? 'best_workflow' : 'worst_workflow',
    pattern: workflowPattern,
    description: `Workflow: ${telemetry.leadersUsed.length} leaders, ${telemetry.toolCallCount} tools, ${telemetry.debateTriggered ? 'with debate' : 'no debate'}, confidence ${telemetry.confidence}%`,
    confidence: telemetry.confidence,
    success: telemetry.status === 'completed',
    missionId: telemetry.missionId,
    metadata: { duration: telemetry.duration, retries: telemetry.retries, corrections: telemetry.executiveCorrections },
  })

  // Extract failure pattern (if errors occurred)
  if (telemetry.errors.length > 0) {
    const errorPattern = telemetry.errors[0].slice(0, 80)
    await upsertKnowledgeEntry({
      type: 'common_failure',
      pattern: errorPattern,
      description: `Recurring error: ${errorPattern}`,
      confidence: telemetry.confidence,
      success: false,
      missionId: telemetry.missionId,
      metadata: { errorCount: telemetry.errors.length, allErrors: telemetry.errors.slice(0, 3) },
    })
  }

  // Extract success pattern (if high confidence + verified)
  if (telemetry.confidence >= 85 && telemetry.verificationPassed) {
    await upsertKnowledgeEntry({
      type: 'common_success',
      pattern: workflowPattern,
      description: `High-confidence verified mission: ${telemetry.goal.slice(0, 80)}`,
      confidence: telemetry.confidence,
      success: true,
      missionId: telemetry.missionId,
      metadata: { verificationScore: telemetry.verificationScore, leaders: telemetry.leadersUsed },
    })
  }

  // Extract reasoning pattern (debate vs solo, corrections)
  const reasoningPattern = `${telemetry.debateTriggered ? 'debate' : 'solo'}|${telemetry.executiveCorrections > 0 ? 'corrected' : 'clean'}`
  await upsertKnowledgeEntry({
    type: 'reasoning_pattern',
    pattern: reasoningPattern,
    description: `Reasoning: ${telemetry.debateTriggered ? 'debate-triggered' : 'solo-leader'}, ${telemetry.executiveCorrections > 0 ? `${telemetry.executiveCorrections} correction(s)` : 'no corrections'}`,
    confidence: telemetry.confidence,
    success: telemetry.status === 'completed',
    missionId: telemetry.missionId,
    metadata: { corrections: telemetry.executiveCorrections, debate: telemetry.debateTriggered, verificationScore: telemetry.verificationScore },
  })

  console.log(`[org-kb] Mission ${telemetry.missionId} ingested — 5-6 knowledge entries updated`)
}

// ═══════════════════════════════════════════════════════════════
// UPSERT: Create or update a knowledge entry
// ═══════════════════════════════════════════════════════════════

async function upsertKnowledgeEntry(input: {
  type: KnowledgeType
  pattern: string
  description: string
  confidence: number
  success: boolean
  missionId: string
  metadata?: Record<string, any>
}): Promise<void> {
  try {
    // Find existing entry with same type + pattern
    const existing = await db.memory.findFirst({
      where: {
        category: 'org_knowledge',
        key: { startsWith: `orgkb_${input.type}_${input.pattern.slice(0, 50)}` },
      },
      orderBy: { createdAt: 'desc' },
    })

    if (existing) {
      // Update existing entry
      const entry: OrgKnowledgeEntry = JSON.parse(existing.value)
      entry.occurrences++
      entry.confidence = Math.round((entry.confidence * (entry.occurrences - 1) + input.confidence) / entry.occurrences)
      entry.successRate = Math.round((entry.successRate * (entry.occurrences - 1) + (input.success ? 100 : 0)) / entry.occurrences)
      entry.lastSeen = new Date().toISOString()
      if (!entry.missionIds.includes(input.missionId)) {
        entry.missionIds.push(input.missionId)
        if (entry.missionIds.length > 20) entry.missionIds = entry.missionIds.slice(-20)  // keep last 20
      }
      if (input.metadata) {
        entry.metadata = { ...entry.metadata, ...input.metadata, lastMission: input.missionId }
      }

      await db.memory.update({
        where: { id: existing.id },
        data: { value: JSON.stringify(entry) },
      })
    } else {
      // Create new entry
      const entry: OrgKnowledgeEntry = {
        entryId: `orgkb_${input.type}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: input.type,
        pattern: input.pattern,
        description: input.description,
        confidence: input.confidence,
        successRate: input.success ? 100 : 0,
        occurrences: 1,
        lastSeen: new Date().toISOString(),
        missionIds: [input.missionId],
        metadata: input.metadata,
      }

      await db.memory.create({
        data: {
          key: entry.entryId,
          value: JSON.stringify(entry),
          category: 'org_knowledge',
        },
      })
    }
  } catch (e: any) {
    console.error(`[org-kb] Upsert failed for ${input.type}/${input.pattern.slice(0, 30)}: ${e?.message}`)
  }
}

// ═══════════════════════════════════════════════════════════════
// QUERY: Retrieve organizational knowledge
// ═══════════════════════════════════════════════════════════════

/**
 * Get all organizational knowledge entries, optionally filtered by type.
 */
export async function getOrgKnowledge(type?: KnowledgeType, limit: number = 50): Promise<OrgKnowledgeEntry[]> {
  try {
    const records = await db.memory.findMany({
      where: {
        category: 'org_knowledge',
        ...(type ? { key: { startsWith: `orgkb_${type}_` } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    return records.map(r => {
      try { return JSON.parse(r.value) as OrgKnowledgeEntry }
      catch { return null }
    }).filter(Boolean) as OrgKnowledgeEntry[]
  } catch {
    return []
  }
}

/**
 * Get the best workflows (highest confidence + success rate).
 */
export async function getBestWorkflows(limit: number = 10): Promise<OrgKnowledgeEntry[]> {
  const all = await getOrgKnowledge('best_workflow', 50)
  return all
    .sort((a, b) => (b.confidence * b.successRate) - (a.confidence * a.successRate))
    .slice(0, limit)
}

/**
 * Get the worst workflows (lowest confidence or failed).
 */
export async function getWorstWorkflows(limit: number = 10): Promise<OrgKnowledgeEntry[]> {
  const all = await getOrgKnowledge('worst_workflow', 50)
  return all
    .sort((a, b) => (a.confidence * a.successRate) - (b.confidence * b.successRate))
    .slice(0, limit)
}

/**
 * Get common failures (most recurring error patterns).
 */
export async function getCommonFailures(limit: number = 10): Promise<OrgKnowledgeEntry[]> {
  const all = await getOrgKnowledge('common_failure', 50)
  return all
    .sort((a, b) => b.occurrences - a.occurrences)
    .slice(0, limit)
}

/**
 * Get common successes (most recurring success patterns).
 */
export async function getCommonSuccesses(limit: number = 10): Promise<OrgKnowledgeEntry[]> {
  const all = await getOrgKnowledge('common_success', 50)
  return all
    .sort((a, b) => b.occurrences - a.occurrences)
    .slice(0, limit)
}

/**
 * Get leader combinations (which leaders work well together).
 */
export async function getLeaderCombinations(limit: number = 10): Promise<OrgKnowledgeEntry[]> {
  const all = await getOrgKnowledge('leader_combination', 50)
  return all
    .sort((a, b) => (b.confidence * b.successRate) - (a.confidence * a.successRate))
    .slice(0, limit)
}

/**
 * Get best reasoning patterns (which cognitive styles produce best results).
 */
export async function getReasoningPatterns(limit: number = 10): Promise<OrgKnowledgeEntry[]> {
  const all = await getOrgKnowledge('reasoning_pattern', 50)
  return all
    .sort((a, b) => (b.confidence * b.successRate) - (a.confidence * a.successRate))
    .slice(0, limit)
}

/**
 * Get a summary of all organizational knowledge.
 */
export async function getOrgKnowledgeSummary(): Promise<{
  totalEntries: number
  byType: Record<KnowledgeType, number>
  topBestWorkflow: OrgKnowledgeEntry | null
  topWorstWorkflow: OrgKnowledgeEntry | null
  topFailure: OrgKnowledgeEntry | null
  topSuccess: OrgKnowledgeEntry | null
  topLeaderCombo: OrgKnowledgeEntry | null
  topReasoningPattern: OrgKnowledgeEntry | null
}> {
  const [best, worst, failures, successes, leaders, reasoning] = await Promise.all([
    getBestWorkflows(1),
    getWorstWorkflows(1),
    getCommonFailures(1),
    getCommonSuccesses(1),
    getLeaderCombinations(1),
    getReasoningPatterns(1),
  ])

  const all = await getOrgKnowledge(undefined, 500)
  const byType: Record<KnowledgeType, number> = {
    best_workflow: 0,
    worst_workflow: 0,
    common_failure: 0,
    common_success: 0,
    leader_combination: 0,
    reasoning_pattern: 0,
  }
  for (const entry of all) {
    byType[entry.type]++
  }

  return {
    totalEntries: all.length,
    byType,
    topBestWorkflow: best[0] || null,
    topWorstWorkflow: worst[0] || null,
    topFailure: failures[0] || null,
    topSuccess: successes[0] || null,
    topLeaderCombo: leaders[0] || null,
    topReasoningPattern: reasoning[0] || null,
  }
}

/**
 * Query organizational knowledge by keyword (for the CEO to use before missions).
 * Returns relevant knowledge entries that match the query.
 */
export async function queryOrgKnowledge(query: string, limit: number = 5): Promise<OrgKnowledgeEntry[]> {
  try {
    const all = await getOrgKnowledge(undefined, 500)
    const lower = query.toLowerCase()
    return all
      .filter(e => e.pattern.toLowerCase().includes(lower) || e.description.toLowerCase().includes(lower))
      .sort((a, b) => (b.confidence * b.successRate * b.occurrences) - (a.confidence * a.successRate * a.occurrences))
      .slice(0, limit)
  } catch {
    return []
  }
}
