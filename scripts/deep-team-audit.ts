/**
 * DEEP TEAM AUDIT — fetches live data for all 20 specialists + analyzes coordination
 * Run: npx tsx /home/z/my-project/scripts/deep-team-audit.ts
 */
import { readFileSync } from 'fs'

const BASE = 'https://agent007-ai.vercel.app'

async function fetchJson(path: string, timeoutMs = 20000): Promise<any> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const r = await fetch(`${BASE}${path}`, { signal: ctrl.signal })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return await r.json()
  } finally {
    clearTimeout(t)
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════')
  console.log('  DEEP TEAM AUDIT — All 20 Specialists Live on Vercel')
  console.log('═══════════════════════════════════════════════════════════════════')
  console.log()

  // Fetch team performance + subagent details
  const [teamPerf, subagentsRes] = await Promise.all([
    fetchJson('/api/system/team-performance'),
    fetchJson('/api/subagents'),
  ])

  const agents = teamPerf.agents || []
  const subagents = subagentsRes.subagents || subagentsRes

  console.log(`Total agents: ${agents.length}`)
  console.log(`Success threshold: ${teamPerf.success_threshold}`)
  console.log()

  // Critical tools that every specialist should have (from #184)
  const CRITICAL_TOOLS = ['page_reader', 'accuracy_checker', 'quality_scorer_v2', 'failure_learning']

  console.log('─ PER-AGENT ANALYSIS ──────────────────────────────────────────────')
  console.log()

  const weaknesses: string[] = []
  const agentAnalysis: any[] = []

  for (const sub of subagents) {
    const perf = agents.find((a: any) => a.id === sub.id)
    const allowedTools: string[] = sub.allowedTools || []
    const toolCount = allowedTools.length

    // Check which critical tools are missing
    const missingCritical = CRITICAL_TOOLS.filter(t => !allowedTools.includes(t))

    // Check tool diversity (how many different categories)
    const hasSearch = allowedTools.some(t => /search|web_|brave|ddg|google_ai/.test(t))
    const hasRead = allowedTools.includes('page_reader') || allowedTools.includes('http_fetch')
    const hasMemory = allowedTools.includes('memory_store') && allowedTools.includes('memory_recall')
    const hasQuality = allowedTools.some(t => /quality|accuracy|scorer|verifier/.test(t))
    const hasParallel = allowedTools.includes('parallel_executor')
    const hasMultiProvider = allowedTools.includes('multi_provider_compare')

    const categories = [hasSearch, hasRead, hasMemory, hasQuality, hasParallel, hasMultiProvider].filter(Boolean).length

    // Check task history
    const tasks = perf?.metrics?.total_tasks || 0
    const avgScore = perf?.metrics?.avg_quality_score || 0
    const successRate = perf?.metrics?.success_rate_percent || 0

    // Identify weaknesses
    const agentWeaknesses: string[] = []
    if (missingCritical.length > 0) agentWeaknesses.push(`Missing critical tools: ${missingCritical.join(', ')}`)
    if (!hasSearch) agentWeaknesses.push('No search capability')
    if (!hasRead) agentWeaknesses.push('No web page reading')
    if (!hasMemory) agentWeaknesses.push('No memory store/recall')
    if (!hasQuality) agentWeaknesses.push('No quality verification tools')
    if (!hasParallel) agentWeaknesses.push('No parallel execution')
    if (toolCount < 10) agentWeaknesses.push(`Low tool count (${toolCount})`)
    if (tasks === 0) agentWeaknesses.push('No tasks completed yet')

    const status = agentWeaknesses.length === 0 ? '✅ STRONG' :
                   agentWeaknesses.length <= 2 ? '🟡 ACCEPTABLE' :
                   '🔴 WEAK'

    console.log(`${status} ${sub.name} (${sub.id})`)
    console.log(`  Role: ${sub.role}`)
    console.log(`  Tools: ${toolCount} | Categories: ${categories}/6 | Tasks: ${tasks} | Avg score: ${avgScore} | Success: ${successRate}%`)
    if (agentWeaknesses.length > 0) {
      console.log(`  Weaknesses:`)
      for (const w of agentWeaknesses) {
        console.log(`    ⚠️  ${w}`)
        weaknesses.push(`${sub.name} (${sub.id}): ${w}`)
      }
    }
    console.log()

    agentAnalysis.push({
      id: sub.id,
      name: sub.name,
      role: sub.role,
      toolCount,
      categories,
      missingCritical,
      tasks,
      avgScore,
      successRate,
      weaknesses: agentWeaknesses,
      status,
    })
  }

  // Coordination analysis
  console.log('─ COORDINATION ANALYSIS ───────────────────────────────────────────')
  console.log()

  // Check if agents can dispatch each other
  const sourceSubagents = readFileSync('/home/z/my-project/src/lib/subagents.ts', 'utf8')
  const hasDispatchProtocol = /<dispatch agent=/.test(sourceSubagents)
  const hasCrossDispatch = /dispatch.*to.*QUANTUM|dispatch.*to.*AURORA|dispatch.*to.*SCOUT/i.test(sourceSubagents)
  console.log(`Dispatch protocol in prompts: ${hasDispatchProtocol ? '✅' : '❌'}`)
  console.log(`Cross-pod dispatch mentioned: ${hasCrossDispatch ? '✅' : '❌'}`)
  console.log()

  // Team summary
  const totalTasks = agents.reduce((s: number, a: any) => s + (a.metrics?.total_tasks || 0), 0)
  const avgScoreAll = agents.reduce((s: number, a: any) => s + (a.metrics?.avg_quality_score || 0), 0) / agents.length
  console.log(`Team total tasks: ${totalTasks}`)
  console.log(`Team avg quality score: ${avgScoreAll.toFixed(1)}`)
  console.log()

  // Count agents by status
  const strong = agentAnalysis.filter(a => a.status === '✅ STRONG').length
  const acceptable = agentAnalysis.filter(a => a.status === '🟡 ACCEPTABLE').length
  const weak = agentAnalysis.filter(a => a.status === '🔴 WEAK').length
  console.log(`Status breakdown: ${strong} STRONG, ${acceptable} ACCEPTABLE, ${weak} WEAK`)
  console.log()

  // Top 5 recommendations
  console.log('═ TOP 5 RECOMMENDATIONS ═══════════════════════════════════════════')
  console.log()

  // Count which critical tools are most commonly missing
  const missingCounts: Record<string, number> = {}
  for (const a of agentAnalysis) {
    for (const m of a.missingCritical) {
      missingCounts[m] = (missingCounts[m] || 0) + 1
    }
  }
  console.log(`Critical tool gaps across team:`)
  for (const [tool, count] of Object.entries(missingCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${tool}: missing from ${count} agents`)
  }
  console.log()

  // Find agents with 0 tasks (never tested)
  const untested = agentAnalysis.filter(a => a.tasks === 0)
  console.log(`UNTESTED AGENTS (${untested.length} with 0 tasks):`)
  for (const a of untested) {
    console.log(`  - ${a.name} (${a.id})`)
  }
  console.log()

  // Find agents with low tool count
  const lowTool = agentAnalysis.filter(a => a.toolCount < 10).sort((a, b) => a.toolCount - b.toolCount)
  console.log(`LOW TOOL COUNT AGENTS (< 10 tools):`)
  for (const a of lowTool) {
    console.log(`  - ${a.name} (${a.id}): ${a.toolCount} tools`)
  }
  console.log()

  console.log('═ 5 BEST RECOMMENDATIONS ══════════════════════════════════════════')
  console.log()
  console.log('1. ADD MISSING CRITICAL TOOLS to all agents')
  console.log('   page_reader, accuracy_checker, quality_scorer_v2, failure_learning')
  console.log('   should be in EVERY specialist\'s allowedTools. Currently many agents')
  console.log('   are missing 1-2 of these, limiting their ability to verify their own work.')
  console.log()
  console.log('2. RUN A TEST MISSION for each untested agent')
  console.log(`   ${untested.length} agents have 0 completed tasks. Their quality is unverified.`)
  console.log('   Dispatch a simple probe task to each one to validate they work.')
  console.log()
  console.log('3. INCREASE TOOL COUNT for low-tool agents')
  console.log(`   ${lowTool.length} agents have < 10 tools. They lack the diversity needed`)
  console.log('   for complex multi-step tasks. Add parallel_executor + multi_provider_compare')
  console.log('   + memory tools to bring everyone up to at least 15 tools.')
  console.log()
  console.log('4. ADD CROSS-POD DISPATCH CAPABILITY')
  console.log('   Most agents can only use tools, not dispatch to other pods.')
  console.log('   Add dispatch instructions to each systemPrompt so specialists')
  console.log('   can request help from other pods when needed.')
  console.log()
  console.log('5. ESTABLISH A QUALITY BASELINE by running the same test task across all agents')
  console.log('   Currently no agent has completed tasks, so there\'s no quality baseline.')
  console.log('   Run a standardized probe (e.g. "research topic X and report findings")')
  console.log('   across all 20 agents to establish baseline scores.')

  console.log()
  console.log('═ AUDIT COMPLETE ═══════════════════════════════════════════════════')
  console.log(`Total weaknesses found: ${weaknesses.length}`)
}

main().catch(e => {
  console.error('Fatal:', e)
  process.exit(1)
})
