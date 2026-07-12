/**
 * generate-upgrade57-backup.ts
 *
 * Generates the full backup for Upgrade #57:
 *   - download/agent007-upgrade57-backup.json (full structured backup)
 *   - download/agent007-upgrade57-backup.zip  (zip of the JSON + key source files)
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execSync } from 'node:child_process'

const ROOT = '/home/z/my-project'
const DOWNLOAD = path.join(ROOT, 'download')
if (!fs.existsSync(DOWNLOAD)) fs.mkdirSync(DOWNLOAD, { recursive: true })

async function main() {
  const { SUBAGENTS } = await import(path.join(ROOT, 'src/lib/subagents.ts'))
  const { UPGRADE_MANIFEST, getAllUpgrades } = await import(
    path.join(ROOT, 'src/lib/upgrade-manifest.ts')
  )
  const { TOOL_REGISTRY } = await import(path.join(ROOT, 'src/lib/tools.ts'))

  const tools = Object.keys(TOOL_REGISTRY)
  const upgrades = getAllUpgrades()

  const qaMonitor = SUBAGENTS.find((s) => s.id === 'testfast2')!
  const extMonitor = SUBAGENTS.find((s) => s.id === 'fasttest3')!

  const monitorAgentsSrc = fs.readFileSync(
    path.join(ROOT, 'src/lib/monitor-agents.ts'),
    'utf-8'
  )
  const qaRouteSrc = fs.readFileSync(
    path.join(ROOT, 'src/app/api/monitor/qa/route.ts'),
    'utf-8'
  )
  const extRouteSrc = fs.readFileSync(
    path.join(ROOT, 'src/app/api/monitor/external/route.ts'),
    'utf-8'
  )
  const vercelJson = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf-8')
  )

  const gitCommit = (() => {
    try {
      return execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim()
    } catch {
      return null
    }
  })()

  const monitoredEndpoints = [
    'https://agent007-ai.vercel.app',
    'https://agent007-ai.vercel.app/api/health',
    'https://agent007-ai.vercel.app/api/system/manifest',
    'https://agent007-ai.vercel.app/api/subagents',
    'https://api.resend.com',
    'https://api.coingecko.com/api/v3/ping',
    'https://api.github.com',
    'https://hn.algolia.com/api/v1/search?tags=front_page',
    'https://www.reddit.com/r/artificial/top.json?limit=1',
    'https://public-api.wordpress.com/rest/v1.1/sites/antonioagent007.wordpress.com',
  ]

  const backup = {
    version: 'upgrade-57-v1.0',
    app: 'Agent007 AI',
    exportedAt: new Date().toISOString(),
    exportedBy: 'super-z (upgrade #57 repurpose)',
    gitCommit,
    summary: {
      totalUpgrades: upgrades.length,
      totalTools: tools.length,
      totalSubagents: SUBAGENTS.length,
      repurposedAgents: 2,
      newCronJobs: 2,
      permanentlyLockedAgents: ['testfast2', 'fasttest3'],
      ownerAlertEmail: 'antonio.can2022@hotmail.com',
      productionUrl: 'https://agent007-ai.vercel.app',
    },
    repurpose: {
      testfast2: {
        beforeName: 'TESTFAST2',
        afterName: qaMonitor.name,
        role: qaMonitor.role,
        specialty: qaMonitor.specialty,
        schedule: 'every 1h / 6h / 12h / 24h (auto-picked by UTC hour)',
        tiers: {
          1: 'TIER 1 (every 1h, quick) — system_health_check + database_integrity_check + view_error_logs',
          2: 'TIER 2 (every 6h, standard) — TIER 1 + verify_deployment + sample exhaustive_tool_test',
          3: 'TIER 3 (every 12h, deep) — TIER 2 + comprehensive_self_check + exhaustive_subagent_test',
          4: 'TIER 4 (every 24h, full audit) — TIER 3 + exhaustive_system_test + accuracy_checker',
        },
        cronEndpoint: 'GET /api/monitor/qa',
        cronSchedule: '0 * * * * (hourly at minute 0, UTC)',
        color: qaMonitor.color,
        icon: qaMonitor.icon,
        lockedFields: ['systemPrompt', 'allowedTools', 'enabled'],
        systemPromptLength: qaMonitor.systemPrompt.length,
      },
      fasttest3: {
        beforeName: 'FASTTEST3',
        afterName: extMonitor.name,
        role: extMonitor.role,
        specialty: extMonitor.specialty,
        schedule: 'every 30 min',
        monitoredEndpointCount: monitoredEndpoints.length,
        monitoredEndpoints,
        cronEndpoint: 'GET /api/monitor/external',
        cronSchedule: '0,30 * * * * (every 30 min, UTC)',
        color: extMonitor.color,
        icon: extMonitor.icon,
        lockedFields: ['systemPrompt', 'allowedTools', 'enabled'],
        systemPromptLength: extMonitor.systemPrompt.length,
      },
    },
    cronConfig: vercelJson.crons,
    protection: {
      neverDisableIds: ['testfast2', 'fasttest3'],
      lockedFieldsForNeverDisable: ['systemPrompt', 'allowedTools', 'enabled'],
      deleteProtection: 'DELETE on locked IDs returns 403 with permanent:true',
      putProtection: 'PUT on locked IDs with locked fields returns 403 with permanent:true',
      editPath: 'To modify mission/tool-list/schedule: edit src/lib/subagents.ts + redeploy',
    },
    superAgentIntegration: {
      dispatchVia: '<dispatch_subagent id="testfast2"> or <dispatch_subagent id="fasttest3">',
      toolAccess: 'FULL_ACCESS_TOOLS — every tool in TOOL_REGISTRY is callable',
      memorySharing: 'Reports stored in Memory table (category: qa_health_report | external_uptime_report)',
      recallVia: 'memory_recall({query: "qa_report"}) or memory_recall({query: "external_report"})',
      dashboard: 'Reports appear in right sidebar MEMORY BANK panel',
    },
    ownerAlerting: {
      trigger: 'ANY check fails (ok=false or status!=2xx or latency>5000ms)',
      channel: 'Email via Resend (RESEND_API_KEY)',
      recipient: 'antonio.can2022@hotmail.com',
      subjectQA: '[AGENT007 QA ALERT] X check(s) failed — TIER Y',
      subjectExternal: '[AGENT007 EXTERNAL ALERT] X endpoint(s) failed',
      body: 'Timestamp + duration + total/passed/failed + per-failure detail (name, expected, actual, latency, severity, suggestedFix)',
      dbLog: 'NotificationLog row created with type=qa_alert|external_uptime_alert',
      memoryLog: 'Memory row created with category=qa_alert|external_uptime_alert',
    },
    toolRegistry: {
      total: tools.length,
      names: tools,
    },
    subagents: SUBAGENTS.map((s) => ({
      id: s.id,
      name: s.name,
      role: s.role,
      specialty: s.specialty,
      color: s.color,
      icon: s.icon,
      isBuiltin: s.isBuiltin,
      enabled: s.enabled,
      allowedToolsCount: s.allowedTools.length,
      systemPromptLength: s.systemPrompt.length,
      systemPromptPreview: s.systemPrompt.slice(0, 300),
    })),
    upgradeManifest: {
      total: upgrades.length,
      latest: upgrades[upgrades.length - 1],
      all: upgrades,
    },
    sourceFiles: {
      'src/lib/monitor-agents.ts': monitorAgentsSrc,
      'src/app/api/monitor/qa/route.ts': qaRouteSrc,
      'src/app/api/monitor/external/route.ts': extRouteSrc,
    },
    deployInstructions: {
      reason: 'Vercel CLI requires authentication. Previous session had VERCEL_TOKEN env var which is no longer set.',
      option1: 'Run vercel login interactively in browser, then vercel --prod --yes from /home/z/my-project',
      option2: 'Set VERCEL_TOKEN env var (create at https://vercel.com/account/tokens), then run: vercel --prod --yes --token $VERCEL_TOKEN',
      option3: 'Push to a GitHub remote connected to the Vercel project (auto-deploy on push)',
      verification: 'After deploy, hit https://agent007-ai.vercel.app/api/system/manifest and confirm totalUpgrades=57 + repurpose_2_monitors_57 in IDs list',
    },
  }

  const jsonPath = path.join(DOWNLOAD, 'agent007-upgrade57-backup.json')
  fs.writeFileSync(jsonPath, JSON.stringify(backup, null, 2))
  console.log('JSON backup written:', jsonPath, `(${(fs.statSync(jsonPath).size / 1024).toFixed(1)} KB)`)

  // Build ZIP
  let AdmZip: any
  try {
    AdmZip = require('adm-zip')
  } catch {
    execSync('bun add adm-zip', { cwd: ROOT, stdio: 'inherit' })
    AdmZip = require('adm-zip')
  }
  const zip = new AdmZip()
  zip.addFile('agent007-upgrade57-backup.json', Buffer.from(JSON.stringify(backup, null, 2)))
  zip.addFile('src/lib/monitor-agents.ts', Buffer.from(monitorAgentsSrc))
  zip.addFile('src/app/api/monitor/qa/route.ts', Buffer.from(qaRouteSrc))
  zip.addFile('src/app/api/monitor/external/route.ts', Buffer.from(extRouteSrc))
  zip.addFile('vercel.json', Buffer.from(JSON.stringify(vercelJson, null, 2)))
  const subagentsSrc = fs.readFileSync(path.join(ROOT, 'src/lib/subagents.ts'), 'utf-8')
  zip.addFile('src/lib/subagents.ts', Buffer.from(subagentsSrc))
  const subIdRouteSrc = fs.readFileSync(
    path.join(ROOT, 'src/app/api/subagents/[id]/route.ts'),
    'utf-8'
  )
  zip.addFile('src/app/api/subagents/[id]/route.ts', Buffer.from(subIdRouteSrc))
  const manifestSrc = fs.readFileSync(path.join(ROOT, 'src/lib/upgrade-manifest.ts'), 'utf-8')
  zip.addFile('src/lib/upgrade-manifest.ts', Buffer.from(manifestSrc))

  const readme = [
    '# Agent007 AI — Upgrade #57 Full Backup',
    '',
    'Generated: ' + backup.exportedAt,
    'Git commit: ' + (gitCommit ?? 'n/a'),
    '',
    '## What is in this backup',
    '',
    'This backup captures the complete state of Upgrade #57 — repurposing two legacy',
    'test agents into permanent scheduled monitors:',
    '',
    '1. TESTFAST2 -> QA Monitor (id: testfast2)',
    '   - Internal health checks at 4 depths (1h / 6h / 12h / 24h)',
    '   - Vercel Cron: 0 * * * * (hourly at minute 0, UTC)',
    '   - Tier auto-picked by UTC hour: 09->T4, 21->T3, 03/15->T2, else->T1',
    '   - Endpoint: GET /api/monitor/qa',
    '',
    '2. FASTTEST3 -> External Monitor (id: fasttest3)',
    '   - External uptime monitoring every 30 min',
    '   - Vercel Cron: 0,30 * * * * (every 30 min, UTC)',
    '   - Probes 10 external endpoints in parallel batches of 5',
    '   - Endpoint: GET /api/monitor/external',
    '',
    '## Owner alerting',
    '',
    'Both monitors auto-email antonio.can2022@hotmail.com via Resend on ANY failure.',
    'Email subject includes severity (CRITICAL / HIGH / MEDIUM / LOW).',
    'NotificationLog + Memory rows are created for every alert.',
    '',
    '## Permanent locking',
    '',
    'The two agents are in NEVER_DISABLE_IDS — they CANNOT be:',
    '  - Deleted (DELETE -> 403 with permanent:true)',
    '  - Disabled (PUT {enabled:false} -> 403 with permanent:true)',
    '  - Have systemPrompt / allowedTools modified (PUT -> 403 with permanent:true)',
    '',
    'To modify them, edit src/lib/subagents.ts and redeploy.',
    '',
    '## Super agent integration',
    '',
    'Both monitors are BUILTIN agents in SUBAGENTS with FULL_ACCESS to all tools.',
    'The super agent (Agent007) can dispatch them via:',
    '  <dispatch_subagent id="testfast2">',
    '  <dispatch_subagent id="fasttest3">',
    '',
    'Reports are stored in the Memory table with categories:',
    '  - qa_health_report (every QA run)',
    '  - external_uptime_report (every external run)',
    '  - qa_alert (on failure)',
    '  - external_uptime_alert (on failure)',
    '',
    '## Files in this ZIP',
    '',
    '- agent007-upgrade57-backup.json — full structured backup',
    '- src/lib/monitor-agents.ts — monitor engine',
    '- src/app/api/monitor/qa/route.ts — QA endpoint (Vercel Cron)',
    '- src/app/api/monitor/external/route.ts — External endpoint (Vercel Cron)',
    '- src/app/api/subagents/[id]/route.ts — locking enforcement',
    '- src/lib/subagents.ts — repurposed agent definitions',
    '- src/lib/upgrade-manifest.ts — entry #57',
    '- vercel.json — cron config',
    '',
    '## Deploy instructions',
    '',
    'The Vercel CLI requires authentication. Three options:',
    '',
    '1. Interactive login: run `vercel login` in a terminal, click the link,',
    '   then `vercel --prod --yes` from /home/z/my-project',
    '',
    '2. Token: create a token at https://vercel.com/account/tokens, then:',
    '   export VERCEL_TOKEN="your-token-here"',
    '   cd /home/z/my-project',
    '   vercel --prod --yes --token $VERCEL_TOKEN',
    '',
    '3. Git push: add a GitHub remote, push, let Vercel auto-deploy.',
    '',
    '## Verification (after deploy)',
    '',
    'curl https://agent007-ai.vercel.app/api/system/manifest | jq .totalUpgrades',
    '# should be 57',
    '',
    'curl https://agent007-ai.vercel.app/api/subagents | jq .subagents[].name',
    '# should include "QA Monitor" and "External Monitor"',
    '',
    'curl https://agent007-ai.vercel.app/api/monitor/qa | jq .ok,.monitor,.tier',
    '# should be true,"qa",1-4',
    '',
    'curl https://agent007-ai.vercel.app/api/monitor/external | jq .ok,.monitor,.endpointCount',
    '# should be true,"external",10',
    '',
    '## Upgrade metrics',
    '',
    '- Total upgrades: ' + upgrades.length + ' (was 56, +1 = #57)',
    '- Total tools: ' + tools.length + ' (unchanged)',
    '- Total subagents: ' + SUBAGENTS.length + ' (unchanged)',
    '- New cron jobs: 2 (QA hourly + External every 30 min)',
    '- Permanently locked agents: 2 (testfast2, fasttest3)',
    '- Owner alert email: antonio.can2022@hotmail.com',
  ].join('\n')
  zip.addFile('README.md', Buffer.from(readme))

  const zipPath = path.join(DOWNLOAD, 'agent007-upgrade57-backup.zip')
  zip.writeZip(zipPath)
  console.log('ZIP backup written:', zipPath, `(${(fs.statSync(zipPath).size / 1024).toFixed(1)} KB)`)

  console.log('')
  console.log('===============================================================')
  console.log('  UPGRADE #57 FULL BACKUP COMPLETE')
  console.log('===============================================================')
  console.log('  JSON: ' + jsonPath)
  console.log('  ZIP:  ' + zipPath)
  console.log('  Upgrades: ' + upgrades.length + ' (was 56, +1 = #57)')
  console.log('  Tools: ' + tools.length)
  console.log('  Subagents: ' + SUBAGENTS.length)
  console.log('  Locked agents: testfast2 (QA Monitor) + fasttest3 (External Monitor)')
  console.log('  Cron jobs added: 2 (QA hourly + External every 30 min)')
  console.log('===============================================================')
}

main().catch((e) => {
  console.error('FATAL:', e)
  process.exit(1)
})
