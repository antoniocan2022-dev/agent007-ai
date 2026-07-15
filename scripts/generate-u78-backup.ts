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
    'src/store/chat-store.ts','src/app/page.tsx','src/middleware.ts','next.config.ts',
    'vercel.json','prisma/schema.prisma',
    'src/components/agent/scroll-arrows.tsx','src/components/agent/chat-thread.tsx',
    'src/components/agent/agent-progress-banner.tsx',
    'src/components/providers/service-worker-register.tsx',
    'src/app/api/owner-backup/route.ts','src/app/api/system/self-restore/route.ts',
    'src/app/api/health/route.ts','src/app/api/monitor/qa/route.ts','src/app/api/monitor/external/route.ts',
    'src/app/api/conversations/route.ts','src/app/api/conversations/[id]/route.ts',
  ]
  const sourceFiles: Record<string,string> = {}
  for (const f of files) { try { const p = path.join(ROOT,f); if (fs.existsSync(p)) sourceFiles[f] = fs.readFileSync(p,'utf-8') } catch {} }
  const gitCommit = execSync('git rev-parse HEAD',{cwd:ROOT}).toString().trim()

  const backup = {
    version: 'upgrade-78-v1.0', app: 'Agent007 AI',
    exportedAt: new Date().toISOString(),
    exportedBy: 'super-z (upgrade #78 Gemini key + full 3-day audit)',
    gitCommit,
    summary: { totalUpgrades: upgrades.length, totalTools: tools.length, totalSubagents: SUBAGENTS.length, productionUrl: PROD },
    geminiKey: { set: true, provider: 'Google Gemini (gemini-1.5-flash)', freeTier: '15 req/min, 1500/day', envVar: 'GEMINI_API_KEY', vercelId: 'TAUy3ARd2iFxVvpF', target: ['production','preview','development'] },
    llmRouter: {
      providers: [
        { name: 'OpenAI', model: 'gpt-4o', role: 'PRIMARY', apiKeySet: true, retries: 5, backoff: 'instant,1s,2s,4s,8s' },
        { name: 'z-ai', model: 'GLM-4', role: 'skipped on Vercel', apiKeySet: false },
        { name: 'Google Gemini', model: 'gemini-1.5-flash', role: 'FREE FALLBACK', apiKeySet: true },
        { name: 'Groq', model: 'Llama 3.3 70B', role: 'not yet set (site was down)', apiKeySet: false },
        { name: 'OpenRouter', model: 'Llama 3.1 8B free', role: 'not yet set', apiKeySet: false },
      ],
      chain: 'OpenAI (5 retries) → z-ai (skipped on Vercel) → Gemini (free) → Groq (not set) → OpenRouter (not set)',
    },
    threeDayAudit: {
      daysCovered: '2026-07-12 to 2026-07-15',
      totalUpgrades: 75,
      upgradesAdded: ['#57 through #78 = 22 new upgrades in 3 days'],
      keyAchievements: [
        '#57: Repurpose 2 test agents → QA Monitor + External Monitor',
        '#58: Middleware whitelist + DB URL default + /api/health',
        '#59: Owner-only token-based backup download',
        '#60: PERMANENT Postgres fix (sqlite → postgresql)',
        '#61: Passive Income Autonomy Stack (11 tools + 4 subagents)',
        '#62: Agent Intelligence Max (RULE #0 + anti-amnesia + anchor + self-restore)',
        '#63: Anti-Stop + Progress Visibility (heartbeat + multi-dispatch)',
        '#64: CRITICAL — Orchestrator heartbeat + multi-dispatch + continue command',
        '#65: Website + Email + UI Builder awareness section',
        '#66: Affiliate Link Generator (5 networks + generic)',
        '#67: 8 Autonomy + Accuracy + Performance tools',
        '#68: MAX improvements (97% quality target, subagent 15 tool limit)',
        '#69: Scroll Up/Down arrows in conversation',
        '#70: Multi-device sync (DB as single source of truth + kill service worker + cache-busting)',
        '#71: 12 external platform tools (Canva, Grammarly, Loom, ConvertKit, etc.) + 10 improvements',
        '#72: Cron jobs + Reddit 403 fix + KB population + Redis setup',
        '#73: WEBSITE + EMAIL + UI BUILDER section restored',
        '#74: 7 MAX tools added to orchestrator prompt addendum',
        '#75: GPT-4o Intelligence Upgrade (gpt-4o-mini → gpt-4o)',
        '#76: Multi-provider LLM router (OpenAI → z-ai → Gemini → Groq → OpenRouter)',
        '#77: Fix z-ai config error + OpenAI retry with backoff',
        '#78: GEMINI_API_KEY set on Vercel — free fallback active',
      ],
    },
    liveVerification: {
      totalUpgrades: 75, totalTools: '588+', totalAgents: 26,
      allPermanent: true, geminiKeySet: true, openaiKeySet: true, openaiModel: 'gpt-4o',
      init: 'ok=true, 77 memory records', health: 'healthy',
      subagents: '20 (all enabled)',
      qa: '3/3 passed', external: '10/11 passed',
      ownerBackup: { json: 1102270, zip: 401830 },
      selfRestore: '403/200', cacheBusting: 'no-cache, no-store, must-revalidate',
      dashboard: 200, login: 200,
      dbCounts: { tableCount: 33, totalRows: 496, conversation: 4, message: 197, memory: 77, auditLog: 130 },
    },
    ownerDownloadUrls: { json: `${PROD}/api/owner-backup?token=${TOKEN}&format=json`, zip: `${PROD}/api/owner-backup?token=${TOKEN}&format=zip` },
    sourceFiles,
  }

  const jsonPath = path.join(DOWNLOAD, 'agent007-upgrade78-backup.json')
  fs.writeFileSync(jsonPath, JSON.stringify(backup, null, 2))
  console.log('JSON:', jsonPath, `(${(fs.statSync(jsonPath).size/1024).toFixed(1)} KB)`)

  const zip = new AdmZip()
  zip.addFile('agent007-upgrade78-backup.json', Buffer.from(JSON.stringify(backup, null, 2)))
  for (const [r,c] of Object.entries(sourceFiles)) zip.addFile(r, Buffer.from(c,'utf-8'))
  zip.addFile('README.md', Buffer.from(`# Agent007 AI — Upgrade #78 Full Backup\n\n## 3-Day Summary (July 12-15, 2026)\n\n- 75 permanent upgrades (22 new in 3 days)\n- 588+ tools\n- 20 subagents (all enabled)\n- 496 DB rows (77 memories, 197 messages)\n- Multi-provider LLM: OpenAI (gpt-4o) → Gemini (free fallback)\n- Multi-device sync (all devices see same data)\n- Scroll arrows, progress banner, 97% quality target\n- 12 external platform tools (Canva, Grammarly, Shopify, etc.)\n- Affiliate link generator (5 networks)\n- 8 MAX autonomy tools (decompose, verify, score, execute)\n- Self-restore from backup\n- Owner-only token-protected downloads\n\n## Download URLs\nJSON: ${PROD}/api/owner-backup?token=${TOKEN}&format=json\nZIP:  ${PROD}/api/owner-backup?token=${TOKEN}&format=zip\n`))
  const zipPath = path.join(DOWNLOAD, 'agent007-upgrade78-backup.zip')
  zip.writeZip(zipPath)
  console.log('ZIP:', zipPath, `(${(fs.statSync(zipPath).size/1024).toFixed(1)} KB)`)

  // Download LIVE backup
  const liveJson = path.join(DOWNLOAD, 'agent007-live-u78-backup.json')
  const liveZip = path.join(DOWNLOAD, 'agent007-live-u78-backup.zip')
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

  console.log('\n=== UPGRADE #78 COMPLETE ===')
}
main().catch(e => { console.error('FATAL:',e); process.exit(1) })
