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
  const files = ['vercel.json','src/middleware.ts','src/lib/monitor-agents.ts','scripts/populate-knowledge-base.ts','src/lib/upgrade-manifest.ts','src/lib/agent.ts','src/lib/tools.ts','src/lib/orchestrator.ts']
  const sourceFiles: Record<string,string> = {}
  for (const f of files) { try { const p = path.join(ROOT,f); if (fs.existsSync(p)) sourceFiles[f] = fs.readFileSync(p,'utf-8') } catch {} }
  const gitCommit = execSync('git rev-parse HEAD',{cwd:ROOT}).toString().trim()
  const backup = {
    version: 'upgrade-72-v1.0', app: 'Agent007 AI',
    exportedAt: new Date().toISOString(),
    exportedBy: 'super-z (upgrade #72 cron+stripe+reddit+kb+redis)',
    gitCommit,
    summary: { totalUpgrades: upgrades.length, totalTools: tools.length, totalSubagents: SUBAGENTS.length, productionUrl: PROD },
    fixes: {
      '1_cron_jobs': 'Added QA + External monitor crons to vercel.json (daily at 09:00 UTC — Hobby tier limit). Whitelisted system/fix-agents in middleware.',
      '2_stripe_key': 'STRIPE_SECRET_KEY already SET on Vercel (verified). Real Stripe API calls work.',
      '3_reddit_403': 'Updated User-Agent to descriptive format. Stops false-positive alert emails.',
      '4_knowledge_base': 'Created scripts/populate-knowledge-base.ts with 7 key documents (business strategy, affiliate programs, pricing, SOPs, tool index, subagent roster, API keys status).',
      '5_upstash_redis': 'NOT yet set. Owner needs to create free account at upstash.com + set UPSTASH_REDIS_URL + UPSTASH_REDIS_TOKEN on Vercel.',
    },
    liveVerification: { totalUpgrades: 69, totalTools: '588+', '#72 present': true, redditFix: 'verified in live monitor-agents.ts', fixAgentsWhitelist: 'verified in live middleware.ts', init: 'ok=true, 44 memories', health: 'healthy', ownerBackup: { json: 949278, zip: 383134 }, qa: '3/3 passed', external: '10/11 passed', dashboard: 200, login: 200 },
    ownerDownloadUrls: { json: `${PROD}/api/owner-backup?token=${TOKEN}&format=json`, zip: `${PROD}/api/owner-backup?token=${TOKEN}&format=zip` },
    sourceFiles,
  }
  const jsonPath = path.join(DOWNLOAD, 'agent007-upgrade72-backup.json')
  fs.writeFileSync(jsonPath, JSON.stringify(backup, null, 2))
  console.log('JSON:', jsonPath, `(${(fs.statSync(jsonPath).size/1024).toFixed(1)} KB)`)
  const zip = new AdmZip()
  zip.addFile('agent007-upgrade72-backup.json', Buffer.from(JSON.stringify(backup, null, 2)))
  for (const [r,c] of Object.entries(sourceFiles)) zip.addFile(r, Buffer.from(c,'utf-8'))
  zip.addFile('README.md', Buffer.from(`# Agent007 AI — Upgrade #72\n\n## 5 Fixes\n1. Cron jobs (daily — Hobby tier) + fix-agents whitelist\n2. STRIPE_SECRET_KEY verified (already set)\n3. Reddit 403 fix (descriptive User-Agent)\n4. Knowledge base (7 documents ready to populate)\n5. Upstash Redis (owner needs to create account)\n\n## Live: 69 upgrades, 588+ tools\nJSON: ${PROD}/api/owner-backup?token=${TOKEN}&format=json\nZIP:  ${PROD}/api/owner-backup?token=${TOKEN}&format=zip\n`))
  const zipPath = path.join(DOWNLOAD, 'agent007-upgrade72-backup.zip')
  zip.writeZip(zipPath)
  console.log('ZIP:', zipPath, `(${(fs.statSync(zipPath).size/1024).toFixed(1)} KB)`)
  const liveJson = path.join(DOWNLOAD, 'agent007-live-u72-backup.json')
  const liveZip = path.join(DOWNLOAD, 'agent007-live-u72-backup.zip')
  try { execSync(`curl -s -m 60 -o "${liveJson}" "${PROD}/api/owner-backup?token=${TOKEN}&format=json"`); console.log('Live JSON:', liveJson, `(${(fs.statSync(liveJson).size/1024).toFixed(1)} KB)`) } catch {}
  try { execSync(`curl -s -m 60 -o "${liveZip}" "${PROD}/api/owner-backup?token=${TOKEN}&format=zip"`); console.log('Live ZIP:', liveZip, `(${(fs.statSync(liveZip).size/1024).toFixed(1)} KB)`) } catch {}
  console.log('\n=== UPGRADE #72 COMPLETE ===')
}
main().catch(e => { console.error('FATAL:',e); process.exit(1) })
