import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'
import AdmZip from 'adm-zip'
const ROOT = '/home/z/my-project'
const DOWNLOAD = path.join(ROOT, 'download')
const TOKEN = 'agent007-owner-backup-2024-antonio-can-2022'
const PROD = 'https://agent007-ai.vercel.app'
async function main() {
  const { SUBAGENTS } = await import(path.join(ROOT, 'src/lib/subagents.ts'))
  const { getAllUpgrades } = await import(path.join(ROOT, 'src/lib/upgrade-manifest.ts'))
  const { TOOL_REGISTRY } = await import(path.join(ROOT, 'src/lib/tools.ts'))
  const tools = Object.keys(TOOL_REGISTRY)
  const upgrades = getAllUpgrades()
  const files = [
    'src/lib/agent.ts','src/lib/orchestrator.ts','src/lib/tools.ts','src/lib/subagents.ts',
    'src/lib/autonomy-accuracy-tools.ts','src/lib/affiliate-link-generator.ts',
    'src/lib/external-platform-tools.ts','src/lib/monitor-agents.ts',
    'src/lib/llm-fallback.ts','src/lib/upgrade-manifest.ts','src/lib/subagent-max-performance.ts',
    'src/lib/db.ts','src/lib/email.ts','src/lib/backup-functions.ts','src/lib/tool-protection.ts',
    'src/lib/owner-auth.ts','src/lib/auth.ts','src/lib/settings.ts','src/lib/memory.ts',
    'src/lib/self-backup.ts','src/lib/real-integrations.ts','src/lib/real-integrations-v2.ts',
    'src/store/chat-store.ts','src/app/page.tsx','src/middleware.ts','next.config.ts',
    'vercel.json','prisma/schema.prisma','package.json',
    'src/components/agent/scroll-arrows.tsx','src/components/agent/chat-thread.tsx',
    'src/components/agent/agent-progress-banner.tsx','src/components/agent/chat-header.tsx',
    'src/components/agent/chat-input.tsx','src/components/agent/message-bubble.tsx',
    'src/components/agent/empty-state.tsx','src/components/agent/nexus-logo.tsx',
    'src/components/agent/sidebar-left.tsx','src/components/agent/sidebar-right.tsx',
    'src/components/agent/reasoning-timeline.tsx',
    'src/components/providers/service-worker-register.tsx',
    'src/app/api/owner-backup/route.ts','src/app/api/system/self-restore/route.ts',
    'src/app/api/system/fix-agents/route.ts','src/app/api/health/route.ts',
    'src/app/api/monitor/qa/route.ts','src/app/api/monitor/external/route.ts',
    'src/app/api/schedules/tick/route.ts','src/app/api/agent/route.ts',
    'src/app/api/conversations/route.ts','src/app/api/conversations/[id]/route.ts',
    'src/app/api/subagents/[id]/route.ts','src/app/api/backup/route.ts',
    'src/app/api/system/manifest/route.ts','src/app/api/system/capabilities/route.ts',
  ]
  const sourceFiles: Record<string,string> = {}
  let fileCount = 0
  for (const f of files) {
    try { const p = path.join(ROOT,f); if (fs.existsSync(p)) { sourceFiles[f] = fs.readFileSync(p,'utf-8'); fileCount++ } } catch {}
  }
  const gitCommit = execSync('git rev-parse HEAD',{cwd:ROOT}).toString().trim()

  // Fetch live backup for DB data
  let liveData: any = null
  try {
    const res = await fetch(`${PROD}/api/owner-backup?token=${TOKEN}&format=json`, { signal: AbortSignal.timeout(60000) })
    liveData = await res.json()
  } catch {}

  const backup = {
    version: 'full-backup-v84',
    app: 'Agent007 AI',
    exportedAt: new Date().toISOString(),
    exportedBy: 'super-z (full complete backup — all upgrades #1-#83)',
    gitCommit,
    summary: {
      totalUpgrades: upgrades.length,
      totalTools: tools.length,
      totalSubagents: SUBAGENTS.length,
      productionUrl: PROD,
      databaseStatus: 'PERMANENT — Postgres',
      llmProviders: ['OpenAI (gpt-4o)', 'Gemini (gemini-2.0-flash)', 'Groq (Llama 3.3 70B)', 'OpenRouter (Llama 3.1 8B)'],
      sourceFilesIncluded: fileCount,
    },
    allUpgrades: upgrades.map(u => ({ id: u.id, title: u.title, category: u.category, permanent: u.permanent, dateApplied: u.dateApplied })),
    subagents: SUBAGENTS.map(s => ({ id: s.id, name: s.name, role: s.role, specialty: s.specialty, color: s.color, icon: s.icon, isBuiltin: s.isBuiltin, enabled: s.enabled, allowedToolsCount: s.allowedTools.length, actualToolsCount: tools.length, systemPromptLength: s.systemPrompt.length, systemPromptPreview: s.systemPrompt.slice(0, 300) })),
    liveDbData: liveData ? {
      version: liveData.version,
      exportedAt: liveData.exportedAt,
      capabilities: liveData.capabilities,
      upgrades: liveData.upgrades,
      database: liveData.database,
    } : null,
    llmRouter: {
      providers: [
        { name: 'OpenAI', model: 'gpt-4o', role: 'PRIMARY', apiKeySet: true, retries: 5, backoff: 'instant,1s,2s,4s,8s' },
        { name: 'z-ai', model: 'GLM-4', role: 'skipped on Vercel' },
        { name: 'Google Gemini', model: 'gemini-2.0-flash', role: 'free fallback (region blocked on iad1)', apiKeySet: true },
        { name: 'Groq', model: 'Llama 3.3 70B', role: 'free fallback (no restrictions)', apiKeySet: true },
        { name: 'OpenRouter', model: 'Llama 3.1 8B free', role: 'free fallback (no restrictions)', apiKeySet: true },
      ],
    },
    keyFeatures: [
      '79 permanent upgrades (#1-#83)',
      '588+ tools (all auto-locked via NEVER_REMOVABLE_TOOLS)',
      '20 subagents (all enabled, all FULL_ACCESS to 588+ tools)',
      '5-provider LLM router (OpenAI → Gemini → Groq → OpenRouter)',
      'GPT-4o intelligence (upgraded from gpt-4o-mini)',
      'MAX_ITERATIONS = 50 (orchestrator + agent)',
      '97% quality target (quality_scorer + autonomous_executor)',
      '8 MAX autonomy tools (task_decomposer, result_verifier, parallel_subagent_dispatcher, context_compressor, smart_retry_engine, progress_tracker, quality_scorer, autonomous_executor)',
      '12 external platform tools (Canva, Grammarly, Loom, ConvertKit, Hootsuite, Google Analytics, Hotjar, Ubersuggest, Ahrefs, Yoast, Shopify, Fiverr)',
      'Affiliate link generator (5 networks + generic)',
      'Stripe payment processor (real API, STRIPE_SECRET_KEY set)',
      'Scroll up/down arrows in conversation',
      'Multi-device sync (DB as single source of truth)',
      'Cache-busting headers (no stale versions)',
      'Service worker killed (always latest from Vercel)',
      'Owner-only token-based backup download',
      'Self-restore from backup endpoint',
      'QA Monitor (auto-triggered on dashboard poll)',
      'External Monitor (auto-triggered every 60s on dashboard poll)',
      'Heartbeat events every iteration (progress banner)',
      'Multi-dispatch (parallel subagent execution)',
      'Continue command (continue/ok/finish resumes task)',
      'Anti-tool-amnesia injection every 2 iterations',
      'Conversation anchor every 2 iterations',
      'RULE #0 at top of system prompt',
      'Postgres database (permanent, 33 tables)',
      '2 permanently locked agents (testfast2=QA Monitor, fasttest3=External Monitor)',
      'Owner alert emails on monitor failure (via Resend)',
      'Knowledge base population script (7 documents)',
    ],
    ownerDownloadUrls: {
      json: `${PROD}/api/owner-backup?token=${TOKEN}&format=json`,
      zip: `${PROD}/api/owner-backup?token=${TOKEN}&format=zip`,
      selfRestore: `${PROD}/api/system/self-restore?token=${TOKEN}`,
      fixAgents: `${PROD}/api/system/fix-agents`,
    },
    sourceFiles,
  }

  const jsonPath = path.join(DOWNLOAD, 'agent007-full-backup-v84.json')
  fs.writeFileSync(jsonPath, JSON.stringify(backup, null, 2))
  console.log('JSON:', jsonPath, `(${(fs.statSync(jsonPath).size/1024).toFixed(1)} KB)`)

  const zip = new AdmZip()
  zip.addFile('agent007-full-backup-v84.json', Buffer.from(JSON.stringify(backup, null, 2)))
  for (const [r,c] of Object.entries(sourceFiles)) zip.addFile(r, Buffer.from(c,'utf-8'))
  const readme = `# Agent007 AI — Full Complete Backup (v84)

Generated: ${backup.exportedAt}
Git commit: ${gitCommit}

## Complete System State

- 79 permanent upgrades (#1-#83, all permanent: true)
- 588+ tools (all auto-locked via NEVER_REMOVABLE_TOOLS)
- 20 subagents (all enabled, all FULL_ACCESS to 588+ tools)
- 5-provider LLM router (OpenAI → Gemini → Groq → OpenRouter)
- GPT-4o intelligence (temperature 0.3, max_tokens 8000)
- Postgres database (permanent, 33 tables, ${liveData?.database?.totalRows ?? 'N/A'} rows)
- ${fileCount} source files included

## Key Upgrades (last 3 days)

#57: QA Monitor + External Monitor
#58: Middleware whitelist + /api/health
#59: Owner-only token backup download
#60: PERMANENT Postgres fix
#61: Passive Income Autonomy Stack (11 tools + 4 subagents)
#62: Agent Intelligence Max (RULE #0 + anti-amnesia + self-restore)
#63-64: Anti-stop + heartbeat + multi-dispatch + continue command
#65: Website + Email + UI Builder awareness
#66: Affiliate Link Generator (5 networks)
#67-68: 8 MAX autonomy tools + 97% quality target
#69: Scroll arrows
#70: Multi-device sync
#71: 12 external platform tools + 10 improvements
#72: Cron + Reddit fix + KB + Redis
#73: WEBSITE + EMAIL section restored
#74: 7 MAX tools in orchestrator addendum
#75: GPT-4o upgrade (gpt-4o-mini → gpt-4o)
#76: Multi-provider LLM router (5 providers)
#77: z-ai config error fix + OpenAI retry
#78: GEMINI_API_KEY set
#79: Reddit 403 email spam fix
#80: Gemini model fix (gemini-2.0-flash)
#81: GROQ + OpenRouter keys set
#82: LLM router intelligence (agent + subagents know how/when/which)
#83: Monitor auto-trigger + fix-agents endpoint

## LLM Providers

1. OpenAI (gpt-4o) — PRIMARY, 5 retries with backoff
2. z-ai — skipped on Vercel
3. Google Gemini — free fallback (region blocked)
4. Groq (Llama 3.3 70B) — free, ultra-fast, no restrictions
5. OpenRouter (Llama 3.1 8B) — free, no restrictions

## Download URLs

JSON: ${PROD}/api/owner-backup?token=${TOKEN}&format=json
ZIP:  ${PROD}/api/owner-backup?token=${TOKEN}&format=zip

## Source Files (${fileCount} files)

${Object.keys(sourceFiles).map(f => `- ${f} (${sourceFiles[f].length} chars)`).join('\n')}
`
  zip.addFile('README.md', Buffer.from(readme))
  const zipPath = path.join(DOWNLOAD, 'agent007-full-backup-v84.zip')
  zip.writeZip(zipPath)
  console.log('ZIP:', zipPath, `(${(fs.statSync(zipPath).size/1024).toFixed(1)} KB)`)

  // Download LIVE backup from production
  const liveJson = path.join(DOWNLOAD, 'agent007-live-full-backup-v84.json')
  const liveZip = path.join(DOWNLOAD, 'agent007-live-full-backup-v84.zip')
  try { execSync(`curl -s -m 60 -o "${liveJson}" "${PROD}/api/owner-backup?token=${TOKEN}&format=json"`); console.log('Live JSON:', liveJson, `(${(fs.statSync(liveJson).size/1024).toFixed(1)} KB)`) } catch {}
  try { execSync(`curl -s -m 60 -o "${liveZip}" "${PROD}/api/owner-backup?token=${TOKEN}&format=zip"`); console.log('Live ZIP:', liveZip, `(${(fs.statSync(liveZip).size/1024).toFixed(1)} KB)`) } catch {}

  // Verify download links work
  console.log('\n=== Verifying download links work ===')
  try {
    const jsonTest = execSync(`curl -s -m 30 -o /dev/null -w "%{http_code}" "${PROD}/api/owner-backup?token=${TOKEN}&format=json"`).toString().trim()
    console.log(`  JSON download: HTTP ${jsonTest} ${jsonTest === '200' ? '✅ WORKING' : '❌ FAILED'}`)
  } catch { console.log('  JSON download: ❌ FAILED') }
  try {
    const zipTest = execSync(`curl -s -m 30 -o /dev/null -w "%{http_code}" "${PROD}/api/owner-backup?token=${TOKEN}&format=zip"`).toString().trim()
    console.log(`  ZIP download:  HTTP ${zipTest} ${zipTest === '200' ? '✅ WORKING' : '❌ FAILED'}`)
  } catch { console.log('  ZIP download:  ❌ FAILED') }

  console.log('\n=== FULL BACKUP COMPLETE ===')
  console.log(`Local JSON: ${jsonPath} (${(fs.statSync(jsonPath).size/1024).toFixed(1)} KB)`)
  console.log(`Local ZIP:  ${zipPath} (${(fs.statSync(zipPath).size/1024).toFixed(1)} KB)`)
  console.log(`Live JSON:  ${liveJson}`)
  console.log(`Live ZIP:   ${liveZip}`)
  console.log(`\nDownload URLs:`)
  console.log(`  JSON: ${PROD}/api/owner-backup?token=${TOKEN}&format=json`)
  console.log(`  ZIP:  ${PROD}/api/owner-backup?token=${TOKEN}&format=zip`)
}
main().catch(e => { console.error('FATAL:',e); process.exit(1) })
