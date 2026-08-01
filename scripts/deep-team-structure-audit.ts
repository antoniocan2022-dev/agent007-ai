/**
 * DEEP TEAM STRUCTURE AUDIT — analyze each team's structure, intelligence,
 * tools, and capabilities. Provide 5 recommendations per team.
 * Run: npx tsx /home/z/my-project/scripts/deep-team-structure-audit.ts
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
  console.log('  DEEP TEAM STRUCTURE AUDIT — All 8 Pods / 20 Specialists')
  console.log('═══════════════════════════════════════════════════════════════════')
  console.log()

  const [teamPerf, subagentsRes] = await Promise.all([
    fetchJson('/api/system/team-performance'),
    fetchJson('/api/subagents'),
  ])

  const agents = teamPerf.agents || []
  const subagents = subagentsRes.subagents || subagentsRes

  // Pod structure from pods/route.ts
  const PODS = [
    { id: 'scout', name: 'Intelligence & Research', leader: 'SCOUT', members: ['HUNT', 'QUANTUM'], focus: 'Find opportunities, validate demand, research competitors' },
    { id: 'aurora', name: 'Creation & Design', leader: 'AURORA', members: ['QUILL', 'PRISM', 'VERTEX'], focus: 'Create content, design products, build affiliate funnels' },
    { id: 'echo', name: 'Quality Assurance', leader: 'ECHO', members: ['qa_monitor'], focus: 'Test, verify, score quality, ensure 99% target' },
    { id: 'forge', name: 'Engineering', leader: 'FORGE', members: ['developer', 'trader'], focus: 'Build, deploy, fix infrastructure, execute trades' },
    { id: 'pulse', name: 'Monitoring & Ops', leader: 'PULSE', members: ['external_uptime_monitor', 'banker', 'Performance Analyst'], focus: 'Monitor systems, track KPIs, weekly $ contribution board' },
    { id: 'developer', name: 'System Health', leader: 'developer', members: ['qa_monitor', 'external_uptime_monitor'], focus: 'Tool health, API monitoring, infrastructure repair' },
    { id: 'cybersecurity_r', name: 'Compliance & Security', leader: 'cybersecurity_r', members: ['legal', 'cybersecurity_a', 'banker'], focus: 'Legal compliance, tax strategy, security auditing' },
    { id: 'revenue', name: 'Revenue (Passive Income)', leader: 'QUANTUM + AURORA', members: ['trader', 'banker', 'pulse'], focus: 'Owns all passive income streams. Target: $20K/month' },
  ]

  // Read source for systemPrompt analysis
  const subSrc = readFileSync('/home/z/my-project/src/lib/subagents.ts', 'utf8')

  for (const pod of PODS) {
    console.log(`═══ POD: ${pod.name.toUpperCase()} ═══`)
    console.log(`Leader: ${pod.leader}`)
    console.log(`Members: ${pod.members.join(', ')}`)
    console.log(`Focus: ${pod.focus}`)
    console.log()

    // Analyze each member
    for (const memberId of [pod.leader.split(' ')[0].toLowerCase(), ...pod.members]) {
      const sub = subagents.find((s: any) => s.id === memberId || s.name?.toLowerCase() === memberId.toLowerCase())
      if (!sub) {
        console.log(`  ⚠️  ${memberId}: NOT FOUND in live system`)
        continue
      }

      const perf = agents.find((a: any) => a.id === sub.id)
      const tools: string[] = sub.allowedTools || []
      const toolCount = tools.length
      const tasks = perf?.metrics?.total_tasks || 0

      // Tool categories analysis
      const categories = {
        search: tools.filter(t => /search|web_|brave|ddg|google_ai|perplexity|tavily|exa|serpapi|newsapi|jina|reddit|hn|arxiv|github_search|stackoverflow/.test(t)),
        read: tools.filter(t => /page_reader|http_fetch|source_read|inspect_url|wikipedia_read/.test(t)),
        memory: tools.filter(t => /memory_store|memory_recall|semantic_memory/.test(t)),
        quality: tools.filter(t => /quality|accuracy|scorer|verifier|content_verifier|source_quality/.test(t)),
        exec: tools.filter(t => /code_exec|file_write|file_read|tool_fixer|tool_recovery/.test(t)),
        communication: tools.filter(t => /send_email|telegram_notify|ntfy_notify|discord_notify/.test(t)),
        finance: tools.filter(t => /stripe|paypal|yahoo_finance|alpha_vantage|coingecko|fred|kraken|decision_matrix/.test(t)),
        parallel: tools.filter(t => /parallel_executor|multi_provider_compare|multi_search_compare/.test(t)),
      }

      console.log(`  ── ${sub.name} (${sub.id}) ──`)
      console.log(`     Role: ${sub.role}`)
      console.log(`     Tools: ${toolCount} total`)
      console.log(`     Search: ${categories.search.length} | Read: ${categories.read.length} | Memory: ${categories.memory.length} | Quality: ${categories.quality.length}`)
      console.log(`     Exec: ${categories.exec.length} | Comms: ${categories.communication.length} | Finance: ${categories.finance.length} | Parallel: ${categories.parallel.length}`)
      console.log(`     Tasks completed: ${tasks}`)
      if (tasks === 0) console.log(`     ⚠️  UNTESTED — no task history`)

      // Check systemPrompt for thinking protocol + dispatch capability
      const promptSection = subSrc.split(`id: '${sub.id}'`)[1]?.split('isBuiltin')[0] || ''
      const hasThinkingProtocol = /THINKING PROTOCOL|chain.of.thought|<thought>/i.test(promptSection)
      const hasDispatch = /<dispatch|dispatch_subagent|dispatch.*agent=/i.test(promptSection)
      const hasMaxToolCalls = /max.*tool.*call|max.*\d+.*tool/i.test(promptSection)

      console.log(`     Thinking protocol: ${hasThinkingProtocol ? '✅' : '❌'}`)
      console.log(`     Cross-pod dispatch: ${hasDispatch ? '✅' : '❌'}`)
      console.log(`     Tool call limit: ${hasMaxToolCalls ? '✅' : '❌'}`)
      console.log()
    }
    console.log()
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
