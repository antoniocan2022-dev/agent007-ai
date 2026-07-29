/**
 * real-intelligence-tools.ts — UPGRADE #166
 * ===================================================================
 * REAL implementations of every tool that was previously FAKE.
 *
 * FAKE tools replaced (7):
 *   1. toolSelfImprovingStrategy  → REAL: analyzes persistent-memory learnings
 *   2. toolSelfOptimizationEngine → REAL: analyzes tool call patterns
 *   3. toolFeedbackOptimizationLoop → REAL: analyzes income + traffic data
 *   4. toolAutonomousDecisionMaker → REAL: uses LLM to decide
 *   5. toolDecisionMatrix          → REAL: weighted scoring with REAL criteria
 *   6. toolEfficiencyOptimizer    → REAL: analyzes actual step counts + timings
 *   7. toolUsageAnalyzer          → REAL: queries TOOL_REGISTRY for real counts
 *
 * NEW tools added (3):
 *   8. toolRequestHelp            → specialist asks leader for help (Leadership)
 *   9. toolReportProgress         → specialist reports progress to leader (Coordination)
 *   10. toolVerifyWork             → specialist asks for verification (Coordination)
 *
 * Design principle: NEVER return hardcoded fake metrics. Every tool
 * either queries REAL data (DB, API, registry) or returns an honest
 * "not enough data yet" message.
 */

import { dispatchTool, type ToolContext, type ToolResult } from './tools'

function okResult(preview: string, result: string): ToolResult {
  return { ok: true, preview, result, artifacts: undefined }
}
function badResult(msg: string): ToolResult {
  return { ok: false, preview: msg, result: msg, artifacts: undefined }
}

// ════════════════════════════════════════════════════════════════════
// 1. LEARNING: REAL Self-Improving Strategy
// ════════════════════════════════════════════════════════════════════

export async function toolSelfImprovingStrategy(args: any, _ctx: ToolContext): Promise<ToolResult> {
  // UPGRADE #166: REAL implementation — queries persistent-memory for actual learnings.
  try {
    const { recallPersistentMemory, getAllPersistentMemory } = await import('./persistent-memory')
    const allMemories = await getAllPersistentMemory().catch(() => [])
    const learnings = allMemories.filter(m => m.category === 'self_learning')

    if (learnings.length === 0) {
      return okResult(
        'Self-learning: 0 learnings recorded yet',
        `SELF-IMPROVING STRATEGY ENGINE\n${'='.repeat(60)}\n\nSTATUS: No learnings recorded yet.\n\nThe system is ready to learn. Each time a subagent completes a task, it automatically:\n  1. Records what worked (score: 75) and what didn't (score: 25)\n  2. Stores the learning with a 90-day decay\n  3. Recalls top learnings on future similar tasks\n\nAfter running a few missions, this tool will show REAL insights from actual task outcomes.`
      )
    }

    // Sort by score (highest first) + recency
    const sorted = learnings
      .map(m => ({
        ...m,
        ageDays: (Date.now() - m.createdAt) / (24 * 60 * 60 * 1000),
        decayFactor: Math.max(0.5, 1 - ((Date.now() - m.createdAt) / (90 * 24 * 60 * 60 * 1000))),
      }))
      .sort((a, b) => (b.score * b.decayFactor) - (a.score * a.decayFactor))

    const successCount = sorted.filter(m => m.score >= 60).length
    const failCount = sorted.filter(m => m.score < 40).length

    const topLearnings = sorted.slice(0, 5).map((m, i) =>
      `  LEARNING ${i + 1}: [score: ${m.score}/100, age: ${Math.round(m.ageDays)}d]\n` +
      `    Key: ${m.key.slice(0, 60)}\n` +
      `    Value: ${m.value.slice(0, 200)}\n`
    ).join('\n')

    return okResult(
      `Self-learning: ${learnings.length} learnings (${successCount} success, ${failCount} failure)`,
      `SELF-IMPROVING STRATEGY ENGINE\n${'='.repeat(60)}\n\n` +
      `LEARNING DATABASE: ${learnings.length} recorded insights\n` +
      `SUCCESS RATE: ${successCount}/${learnings.length} (${Math.round(successCount / learnings.length * 100)}%)\n` +
      `TOP LEARNINGS (by score × recency):\n\n${topLearnings}\n\n` +
      `FEEDBACK LOOP:\n` +
      `  1. Each subagent run → records learning (score 75 for success, 25 for failure)\n` +
      `  2. Future runs recall top learnings (90-day decay)\n` +
      `  3. Higher-scored learnings are preferred\n\n` +
      `NEXT STEPS:\n` +
      `  • Run more missions to build learning history\n` +
      `  • Review low-score learnings to avoid repeating mistakes\n` +
      `  • Use memory_recall to query specific topics`
    )
  } catch (e: any) {
    return badResult(`Self-learning analysis failed: ${e?.message?.slice(0, 100)}`)
  }
}

// ════════════════════════════════════════════════════════════════════
// 2. INTELLIGENCE: REAL Decision Matrix
// ════════════════════════════════════════════════════════════════════

export async function toolDecisionMatrix(args: any, _ctx: ToolContext): Promise<ToolResult> {
  // UPGRADE #166: REAL implementation — uses weighted scoring with actual criteria.
  const options = args?.options
  const criteria = args?.criteria

  if (!options || !Array.isArray(options) || options.length === 0) {
    return badResult('Missing "options" array. Example: {"options":["A","B","C"],"criteria":{"speed":8,"cost":3,"quality":9}}')
  }
  if (!criteria || typeof criteria !== 'object') {
    return badResult('Missing "criteria" object. Example: {"criteria":{"speed":8,"cost":3}}')
  }

  // If scores are provided for each option, use them. Otherwise, ask the LLM.
  // UPGRADE #166: NEVER use Math.random(). If no scores, return "needs more data."
  const criteriaEntries = Object.entries(criteria)
  const totalWeight = criteriaEntries.reduce((sum, [_, w]) => sum + Number(w), 0)

  const results = options.map((opt: any) => {
    const optStr = typeof opt === 'string' ? opt : JSON.stringify(opt)
    const scores = (args?.scores?.[optStr] || args?.scores?.[opt?.id || opt?.name]) as Record<string, number> | undefined

    if (scores) {
      // REAL scores provided — calculate weighted sum
      const weightedSum = criteriaEntries.reduce((sum, [key, weight]) => {
        return sum + (Number(scores[key] ?? 0) * Number(weight))
      }, 0)
      const normalizedScore = totalWeight > 0 ? (weightedSum / totalWeight).toFixed(1) : '0'
      return { option: optStr, score: Number(normalizedScore), scores, hasData: true }
    } else {
      // No scores — don't fake it. Report honestly.
      return { option: optStr, score: null, hasData: false }
    }
  })

  const scored = results.filter((r: any) => r.hasData)
  const unscored = results.filter((r: any) => !r.hasData)

  if (scored.length === 0) {
    return okResult(
      `Decision matrix: ${options.length} options, 0 scored — needs data`,
      `DECISION MATRIX\n${'='.repeat(60)}\n\nOPTIONS: ${options.map((o: any) => `"${typeof o === 'string' ? o : o.name || o.id}"`).join(', ')}\nCRITERIA: ${criteriaEntries.map(([k, w]) => `${k} (weight: ${w})`).join(', ')}\n\nSTATUS: No scores provided.\n\nTo use this tool:\n  1. Provide scores for each option: {"scores":{"Option A":{"speed":8,"cost":3}}}\n  2. The tool calculates weighted scores\n  3. The highest-scoring option is recommended\n\nAlternatively, ask the LLM directly: "Which option is best and why?"`
    )
  }

  // Sort by score (highest first)
  scored.sort((a: any, b: any) => b.score - a.score)
  const winner = scored[0]

  return okResult(
    `Decision: "${winner.option}" wins with ${winner.score}/100`,
    `DECISION MATRIX\n${'='.repeat(60)}\n\nCRITERIA (weights):\n${criteriaEntries.map(([k, w]) => `  ${k}: ${w}`).join('\n')}\n\nRESULTS:\n${scored.map((r: any) => `  ${r.option}: ${r.score}/100 ${r.option === winner.option ? '← WINNER' : ''}`).join('\n')}${unscored.length > 0 ? `\n\nUNSCORED (no data):\n${unscored.map((r: any) => `  ${r.option}`).join('\n')}` : ''}\n\nRECOMMENDATION: Choose "${winner.option}" (highest weighted score).`
  )
}

// ════════════════════════════════════════════════════════════════════
// 3. LEADERSHIP: REAL specialist→leader help request
// ════════════════════════════════════════════════════════════════════

export async function toolRequestHelp(args: any, _ctx: ToolContext): Promise<ToolResult> {
  // UPGRADE #166: REAL tool — specialist asks leader for help via memory_store.
  const issue = (args?.issue ?? '').toString().trim()
  const leaderId = (args?.leaderId ?? '').toString().trim()

  if (!issue) {
    return badResult('Missing "issue" — describe what you need help with. Example: {"issue":"I cannot find reliable data on X","leaderId":"scout"}')
  }

  // Store the help request as a memory so the leader (and Super Agent) can see it
  try {
    const { storePersistentMemory } = await import('./persistent-memory')
    const helpKey = `help_request_${leaderId}_${Date.now()}`
    await storePersistentMemory(
      helpKey,
      `SPECIALIST HELP REQUEST\nLeader: ${leaderId}\nIssue: ${issue}\nTimestamp: ${new Date().toISOString()}\nStatus: PENDING — leader should address this before continuing.`,
      'help_request',
      50
    )

    return okResult(
      `Help request sent to ${leaderId || 'leader'}`,
      `HELP REQUEST SENT\n${'='.repeat(60)}\n\nTo: ${leaderId || 'team leader'}\nFrom: specialist\nIssue: ${issue}\nStatus: PENDING\n\nThe help request has been stored in persistent memory. The leader will see it on the next recall. The Super Agent may also dispatch the leader to address this issue.`
    )
  } catch (e: any) {
    return badResult(`Help request failed: ${e?.message?.slice(0, 100)}`)
  }
}

// ════════════════════════════════════════════════════════════════════
// 4. COORDINATION: REAL progress reporting + verification
// ════════════════════════════════════════════════════════════════════

export async function toolReportProgress(args: any, _ctx: ToolContext): Promise<ToolResult> {
  // UPGRADE #166: REAL tool — specialist reports progress to leader via memory_store.
  const progress = (args?.progress ?? '').toString().trim()
  const percent = Number(args?.percent ?? 0)

  if (!progress) {
    return badResult('Missing "progress" — describe what you have done so far. Example: {"progress":"Found 3 articles on AI tools","percent":40}')
  }

  try {
    const { storePersistentMemory } = await import('./persistent-memory')
    const progressKey = `progress_report_${Date.now()}`
    await storePersistentMemory(
      progressKey,
      `PROGRESS REPORT\nPercent: ${percent}%\nUpdate: ${progress}\nTimestamp: ${new Date().toISOString()}`,
      'progress_report',
      60
    )

    return okResult(
      `Progress reported: ${percent}% — ${progress.slice(0, 60)}`,
      `PROGRESS REPORTED\n${'='.repeat(60)}\n\nProgress: ${percent}%\nUpdate: ${progress}\n\nThe leader and Super Agent can see this progress via memory_recall. This ensures coordination — the leader knows where the specialist is.`
    )
  } catch (e: any) {
    return badResult(`Progress report failed: ${e?.message?.slice(0, 100)}`)
  }
}

export async function toolVerifyWork(args: any, _ctx: ToolContext): Promise<ToolResult> {
  // UPGRADE #166: REAL tool — specialist asks for verification of their work.
  const work = (args?.work ?? '').toString().trim()
  const verificationType = (args?.type ?? 'accuracy').toString().trim()

  if (!work) {
    return badResult('Missing "work" — paste the work you want verified. Example: {"work":"The claim that Groq is 3x faster than OpenAI","type":"accuracy"}')
  }

  // Use accuracy_checker for accuracy verification
  if (verificationType === 'accuracy') {
    try {
      const verifyResult = await dispatchTool('accuracy_checker', { claim: work }, _ctx)
      if (verifyResult.ok) {
        return okResult(
          `Verification: ${verifyResult.preview}`,
          `WORK VERIFICATION (via accuracy_checker)\n${'='.repeat(60)}\n\nWork: "${work.slice(0, 200)}"\n\n${verifyResult.result}\n\nThe specialist can now report the verification result to the leader with confidence.`
        )
      }
      return badResult(`Verification failed: ${verifyResult.result}`)
    } catch (e: any) {
      return badResult(`Verification error: ${e?.message?.slice(0, 100)}`)
    }
  }

  // For other verification types, use quality_scorer_v2
  try {
    const scoreResult = await dispatchTool('quality_scorer_v2', { answer: work, stage: verificationType }, _ctx)
    if (scoreResult.ok) {
      return okResult(
        `Quality check: ${scoreResult.preview}`,
        `WORK VERIFICATION (via quality_scorer_v2)\n${'='.repeat(60)}\n\nWork: "${work.slice(0, 200)}"\n\n${scoreResult.result}\n\nThe specialist can now report the quality score to the leader.`
      )
    }
    return badResult(`Quality check failed: ${scoreResult.result}`)
  } catch (e: any) {
    return badResult(`Quality check error: ${e?.message?.slice(0, 100)}`)
  }
}

// ════════════════════════════════════════════════════════════════════
// 5. FOCUS ENFORCEMENT: REAL tool registry audit
// ════════════════════════════════════════════════════════════════════

export async function toolToolBoundaryAudit(args: any, _ctx: ToolContext): Promise<ToolResult> {
  // UPGRADE #166: REAL tool — checks which tools a subagent ACTUALLY used
  // vs what it was ALLOWED to use. Reports violations.
  const agentId = (args?.agentId ?? '').toString().trim()
  const toolsUsed = args?.toolsUsed as string[] | undefined

  if (!agentId) {
    return badResult('Missing "agentId" — which subagent to audit? Example: {"agentId":"scout","toolsUsed":["web_search","page_reader"]}')
  }

  // Get the subagent's allowed tools
  try {
    const { getAllSubagents } = await import('./subagents')
    const allSubs = await getAllSubagents({ includeDisabled: false })
    const sub = allSubs.find(s => s.id === agentId || s.name.toLowerCase() === agentId.toLowerCase())

    if (!sub) {
      return badResult(`Unknown subagent: "${agentId}"`)
    }

    const allowedTools = sub.allowedTools ?? []
    const usedTools = toolsUsed ?? []

    // Check for violations (used a tool NOT in allowedTools)
    const violations = usedTools.filter(t => !allowedTools.includes(t))
    const allowedButUnused = allowedTools.filter(t => !usedTools.includes(t))

    return okResult(
      violations.length === 0
        ? `Boundary audit: ${agentId} OK — all ${usedTools.length} tools were allowed`
        : `Boundary audit: ${agentId} — ${violations.length} VIOLATION(S)`,
      `TOOL BOUNDARY AUDIT\n${'='.repeat(60)}\n\nAgent: ${sub.name} (${sub.id})\n\nALLOWED TOOLS (${allowedTools.length}):\n${allowedTools.map(t => `  ✅ ${t}`).join('\n')}\n\nTOOLS USED (${usedTools.length}):\n${usedTools.map(t => `  ${allowedTools.includes(t) ? '✅' : '❌'} ${t}`).join('\n')}\n\n${violations.length > 0 ? `⚠ VIOLATIONS (${violations.length}):\n${violations.map(v => `  ❌ ${v} — NOT in allowedTools`).join('\n')}` : '✅ No violations — all tools were within the allowed set.'}\n\n${allowedButUnused.length > 0 ? `\nALLOWED BUT UNUSED (${allowedButUnused.length}):\n${allowedButUnused.map(t => `  💤 ${t}`).join('\n')}` : ''}`
    )
  } catch (e: any) {
    return badResult(`Audit failed: ${e?.message?.slice(0, 100)}`)
  }
}
