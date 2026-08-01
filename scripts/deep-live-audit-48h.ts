/**
 * DEEP LIVE AUDIT — verifies ALL fixes from the last 48 hours are live on Vercel
 * Run: npx tsx /home/z/my-project/scripts/deep-live-audit-48h.ts
 */
import { readFileSync } from 'fs'

const BASE = 'https://agent007-ai.vercel.app'
const LOCAL = '/home/z/my-project/src'

let pass = 0
let fail = 0
const failures: string[] = []

function ok(name: string, detail?: string) {
  pass++
  console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`)
}
function bad(name: string, detail: string) {
  fail++
  failures.push(`${name}: ${detail}`)
  console.log(`  ❌ ${name} — ${detail}`)
}

async function fetchJson(path: string, timeoutMs = 15000): Promise<any> {
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
  console.log('  DEEP LIVE AUDIT — All 48h Fixes on Vercel')
  console.log('═══════════════════════════════════════════════════════════════════')
  console.log()

  // AUDIT 1: Health + Version
  console.log('─ AUDIT 1: Health + Version')
  try {
    const h = await fetchJson('/api/health')
    if (h.version === 'upgrade-198') ok('Version is upgrade-198', h.version)
    else bad('Version', `expected upgrade-198, got ${h.version}`)
    if (h.status === 'healthy') ok('Status healthy')
    else bad('Status', h.status)
  } catch (e: any) {
    bad('Health endpoint', e.message)
  }

  // AUDIT 2: /api/tools/test
  console.log('─ AUDIT 2: /api/tools/test endpoint (#197)')
  try {
    const t = await fetchJson('/api/tools/test')
    if (t.endpoint === '/api/tools/test') ok('Tools test endpoint exists', `tool_count=${t.tool_count}`)
    else bad('Tools test endpoint', `unexpected shape: ${JSON.stringify(t).slice(0, 100)}`)
  } catch (e: any) {
    bad('Tools test endpoint', e.message)
  }

  // AUDIT 3: Subagents
  console.log('─ AUDIT 3: Subagents (count, IDs, custom agents)')
  try {
    const s = await fetchJson('/api/subagents')
    const subs = s.subagents || s
    const count = subs.length
    if (count === 20) ok('Subagent count is 20', `${count} total`)
    else bad('Subagent count', `expected 20, got ${count}`)

    const ids = subs.map((x: any) => x.id)
    if (ids.includes('qa_monitor')) ok('qa_monitor ID present (was testfast2)')
    else bad('qa_monitor ID', 'MISSING — rename #197 did not land')
    if (ids.includes('external_uptime_monitor')) ok('external_uptime_monitor ID present (was fasttest3)')
    else bad('external_uptime_monitor ID', 'MISSING — rename #197 did not land')
    if (!ids.includes('testfast2') && !ids.includes('fasttest3')) ok('Old test IDs gone')
    else bad('Old test IDs', 'still present — rename incomplete')

    const custom = subs.filter((x: any) => !x.isBuiltin)
    console.log(`    Custom DB agents: ${custom.length}`)
    for (const c of custom) {
      console.log(`      - ${c.id}: ${c.name} (${c.role})`)
    }
  } catch (e: any) {
    bad('Subagents endpoint', e.message)
  }

  // AUDIT 4: Team Performance
  console.log('─ AUDIT 4: Team Performance')
  try {
    const tp = await fetchJson('/api/system/team-performance')
    const agents = tp.agents || []
    ok('Team performance endpoint works', `${agents.length} agents, threshold=${tp.success_threshold}`)
    const aurora = agents.find((a: any) => a.id === 'aurora')
    if (aurora) ok('AURORA present', `allowedToolsCount=${aurora.allowed_tools_count}`)
    else bad('AURORA', 'missing from team-performance')
    // Check QA & Testing team specifically (Antonio mentioned this)
    const echo = agents.find((a: any) => a.id === 'echo')
    if (echo) ok('ECHO (QA) present', `allowedToolsCount=${echo.allowed_tools_count}`)
    else bad('ECHO (QA)', 'missing — QA team data lost?')
    const qaMonitor = agents.find((a: any) => a.id === 'qa_monitor')
    if (qaMonitor) ok('qa_monitor present', `allowedToolsCount=${qaMonitor.allowed_tools_count}`)
    else bad('qa_monitor', 'missing from team-performance')
  } catch (e: any) {
    bad('Team performance endpoint', e.message)
  }

  // AUDIT 5: Capability audit
  console.log('─ AUDIT 5: Capability Audit')
  try {
    const ca = await fetchJson('/api/system/capability-audit')
    const tools = ca.tools || {}
    console.log(`    total_in_registry: ${tools.total_in_registry}`)
    console.log(`    with_credentials: ${tools.with_credentials}`)
    console.log(`    without_credentials: ${tools.without_credentials}`)
    if (tools.total_in_registry >= 670) ok('Tool count in expected range', `${tools.total_in_registry}`)
    else bad('Tool count', `expected ~677, got ${tools.total_in_registry}`)
    if (ca.autonomy_score?.can_earn_real_money_today) ok('Can earn real money today')
    else bad('Revenue capability', 'cannot earn real money')
  } catch (e: any) {
    bad('Capability audit endpoint', e.message)
  }

  // AUDIT 6: LLM providers
  console.log('─ AUDIT 6: LLM Provider Chain')
  try {
    const llm = await fetchJson('/api/system/diagnose-llm')
    console.log(`    chain: ${llm.provider}`)
    if (llm.testResult?.success) ok('LLM chain working', `via ${llm.testResult?.provider}`)
    else bad('LLM chain', 'test failed')
  } catch (e: any) {
    bad('LLM diagnose endpoint', e.message)
  }

  // AUDIT 7: SYSTEM_PROMPT source checks
  console.log('─ AUDIT 7: SYSTEM_PROMPT source checks')
  try {
    const agentSrc = readFileSync(`${LOCAL}/lib/agent.ts`, 'utf8')
    const checks = [
      { name: '20 pod leaders (18 built-in + 2 custom)', rx: /20 pod leaders.*18 built-in.*2 custom/ },
      { name: 'Anti-consulting rule #9', rx: /NEVER recommend building something you already have/ },
      { name: 'ACT rule #10', rx: /ACT, don\\'t advise/ },
      { name: 'Third person rule #11', rx: /Never describe yourself in the third person/ },
      { name: 'Example exchanges block', rx: /EXAMPLE EXCHANGES/ },
      { name: 'CALIBRATED CONFIDENCE', rx: /CALIBRATED CONFIDENCE/ },
      { name: 'Greet Antonio naturally', rx: /Greet Antonio naturally/ },
    ]
    for (const c of checks) {
      const found = c.rx.test(agentSrc)
      if (found) ok(`Source: ${c.name}`)
      else bad(`Source: ${c.name}`, 'missing from source')
    }
    // Verify the OLD contradictory line is gone
    if (/EVERY response.*ALWAYS/.test(agentSrc)) bad('Old ALWAYS greeting', 'still in source')
    else ok('Old ALWAYS greeting removed')
  } catch (e: any) {
    bad('SYSTEM_PROMPT source check', e.message)
  }

  // AUDIT 8: Knowledge base
  console.log('─ AUDIT 8: Knowledge Base (for Task 1 — document injection)')
  try {
    const kb = await fetchJson('/api/kb')
    if (Array.isArray(kb)) {
      console.log(`    KB entries: ${kb.length}`)
      ok('KB endpoint accessible', `${kb.length} entries`)
    } else if (kb.entries) {
      console.log(`    KB entries: ${kb.entries.length}`)
      ok('KB endpoint accessible', `${kb.entries.length} entries`)
    } else {
      console.log(`    KB keys: ${Object.keys(kb).join(', ')}`)
      ok('KB endpoint accessible')
    }
  } catch (e: any) {
    console.log(`    KB endpoint: ${e.message}`)
    bad('KB endpoint', e.message)
  }

  // AUDIT 9: Monitor endpoints
  console.log('─ AUDIT 9: Monitor endpoints (QA + External)')
  try {
    const qa = await fetchJson('/api/monitor/qa', 20000)
    ok('QA monitor endpoint works')
  } catch (e: any) {
    bad('QA monitor endpoint', e.message)
  }
  try {
    const ext = await fetchJson('/api/monitor/external', 20000)
    ok('External monitor endpoint works')
  } catch (e: any) {
    bad('External monitor endpoint', e.message)
  }

  // AUDIT 10: Pods endpoint
  console.log('─ AUDIT 10: Pods endpoint (Antonio mentioned pods lost data)')
  try {
    const pods = await fetchJson('/pods')
    if (Array.isArray(pods)) {
      console.log(`    Pods count: ${pods.length}`)
      for (const p of pods) {
        console.log(`      - ${p.name || p.id}: ${p.memberCount || p.members?.length || '?'} members`)
      }
      ok('Pods endpoint works', `${pods.length} pods`)
    } else {
      console.log(`    Pods keys: ${Object.keys(pods).join(', ')}`)
      ok('Pods endpoint works')
    }
  } catch (e: any) {
    bad('Pods endpoint', e.message)
  }

  // SUMMARY
  console.log()
  console.log('═══════════════════════════════════════════════════════════════════')
  console.log(`  AUDIT COMPLETE — ${pass} passed, ${fail} failed`)
  console.log('═══════════════════════════════════════════════════════════════════')
  if (fail > 0) {
    console.log()
    console.log('FAILURES:')
    for (const f of failures) {
      console.log(`  ❌ ${f}`)
    }
  }
}

main().catch(e => {
  console.error('Fatal:', e)
  process.exit(1)
})
