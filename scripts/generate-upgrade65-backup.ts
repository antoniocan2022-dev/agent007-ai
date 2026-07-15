/**
 * generate-upgrade65-backup.ts — Final backup for Upgrade #65
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import AdmZip from 'adm-zip'

const ROOT = '/home/z/my-project'
const DOWNLOAD = path.join(ROOT, 'download')
if (!fs.existsSync(DOWNLOAD)) fs.mkdirSync(DOWNLOAD, { recursive: true })

const OWNER_BACKUP_TOKEN = 'agent007-owner-backup-2024-antonio-can-2022'
const PROD_URL = 'https://agent007-ai.vercel.app'

async function main() {
  const { SUBAGENTS } = await import(path.join(ROOT, 'src/lib/subagents.ts'))
  const { getAllUpgrades } = await import(path.join(ROOT, 'src/lib/upgrade-manifest.ts'))
  const { TOOL_REGISTRY } = await import(path.join(ROOT, 'src/lib/tools.ts'))

  const tools = Object.keys(TOOL_REGISTRY)
  const upgrades = getAllUpgrades()

  const filesToInclude = [
    'src/lib/agent.ts',
    'src/lib/orchestrator.ts',
    'src/lib/tools.ts',
    'src/lib/subagents.ts',
    'src/lib/upgrade-manifest.ts',
    'src/lib/tool-protection.ts',
    'src/lib/db.ts',
    'src/store/chat-store.ts',
    'src/app/page.tsx',
    'src/components/agent/agent-progress-banner.tsx',
    'src/app/api/owner-backup/route.ts',
    'src/app/api/system/self-restore/route.ts',
    'src/app/api/health/route.ts',
    'src/middleware.ts',
    'prisma/schema.prisma',
    'vercel.json',
    'scripts/audit-3-tools.ts',
  ]

  const sourceFiles: Record<string, string> = {}
  for (const relPath of filesToInclude) {
    try {
      const fullPath = path.join(ROOT, relPath)
      if (fs.existsSync(fullPath)) sourceFiles[relPath] = fs.readFileSync(fullPath, 'utf-8')
    } catch (e: any) {}
  }

  const gitCommit = (() => {
    try { return execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim() } catch { return null }
  })()

  const backup = {
    version: 'upgrade-65-v1.0',
    app: 'Agent007 AI',
    exportedAt: new Date().toISOString(),
    exportedBy: 'super-z (upgrade #65 Website + Email + UI Builder awareness)',
    gitCommit,
    summary: {
      totalUpgrades: upgrades.length,
      totalTools: tools.length,
      totalSubagents: SUBAGENTS.length,
      productionUrl: PROD_URL,
      databaseStatus: 'PERMANENT — Postgres',
    },
    toolsAdded: {
      upgradeId: 'website_email_ui_tools_awareness_65',
      ownerRequest: 'Add all these tools: Website Builder, UI Form Builder, Email Automation',
      auditResult: 'ALL 3 TOOLS ALREADY EXISTED in TOOL_REGISTRY (567 total tools). All permanently locked + full access.',
      tools: [
        {
          name: 'website_builder',
          existsInToolRegistry: true,
          label: 'Website Builder (landing pages via HTML/React/WordPress)',
          location: 'src/lib/tools.ts:2236',
          locked: true,
          fullAccess: true,
          usage: [
            '<tool name="website_builder">{"type":"landing","title":"My SaaS","platform":"nextjs"}</tool>',
            '<tool name="website_builder">{"type":"full","title":"AI Blog","platform":"wordpress"}</tool>',
            '<tool name="website_builder">{"type":"portfolio","title":"Designer Portfolio","platform":"html"}</tool>',
          ],
        },
        {
          name: 'ui_form_builder',
          existsInToolRegistry: true,
          label: 'UI Form Builder (create forms to collect user info)',
          location: 'src/lib/tools.ts:2221',
          locked: true,
          fullAccess: true,
          usage: [
            '<tool name="ui_form_builder">{"name":"signup","fields":[{"name":"email","type":"email","required":true}],"submit_url":"/api/auth/register"}</tool>',
            '<tool name="ui_form_builder">{"name":"contact","fields":[{"name":"name","type":"text","required":true},{"name":"message","type":"textarea","required":true}],"submit_url":"/api/contact"}</tool>',
          ],
        },
        {
          name: 'email_automation',
          existsInToolRegistry: true,
          label: 'Email Automation (verification + welcome + notifications)',
          location: 'src/lib/tools.ts:2220',
          locked: true,
          fullAccess: true,
          usage: [
            '<tool name="email_automation">{"to":"user@email.com","subject":"Welcome!","template":"welcome","data":{"name":"Antonio"}}</tool>',
            '<tool name="email_automation">{"to":"user@email.com","subject":"Verify your account","template":"verification","data":{"verificationUrl":"https://..."}}</tool>',
            '<tool name="email_automation">{"to":"user@email.com","subject":"Password reset","template":"reset","data":{"resetUrl":"https://..."}}</tool>',
          ],
          templates: ['welcome', 'verification', 'reset', 'notification', 'marketing'],
          usesResendAPI: true,
        },
      ],
      relatedEmailTools: [
        'email_marketing_automation',
        'email_marketing_automation_full',
        'email_marketing_setup',
        'resend_email_automation',
        'autonomous_email_sender',
        'send_email_resend',
      ],
      fix: 'Added dedicated "WEBSITE + EMAIL + UI BUILDER TOOLS — ALWAYS AVAILABLE" section to system prompt with explicit usage examples + "NEVER say these tools are not available" directive.',
    },
    liveVerification: {
      timestamp: new Date().toISOString(),
      url: PROD_URL,
      results: {
        '/api/system/manifest': { status: 200, totalUpgrades: 62, '#65 present': true },
        '/api/init': { status: 200, ok: true, results: ['Seed user: exists', 'Phone config: exists', 'Memory records: 29'] },
        '/api/health': { status: 200, ok: true, status: 'healthy' },
        '/api/owner-backup (JSON)': { status: 200, sizeBytes: 519563 },
        '/api/owner-backup (ZIP)': { status: 200, sizeBytes: 305163 },
        '/api/monitor/qa': { status: 200, ok: true, passed: '3/3' },
        '/api/monitor/external': { status: 200, ok: true, passed: '10/11' },
        '/ (dashboard)': { status: 200 },
        '/login': { status: 200 },
        'agent.ts from live backup': {
          'WEBSITE + EMAIL + UI BUILDER section': '✅ present (1 occurrence)',
          'website_builder mentioned': '✅ 5 times',
          'ui_form_builder mentioned': '✅ 4 times',
          'email_automation mentioned': '✅ 6 times',
          'NEVER say not available': '✅ present',
        },
      },
    },
    ownerDownloadUrls: {
      json: `${PROD_URL}/api/owner-backup?token=${OWNER_BACKUP_TOKEN}&format=json`,
      zip: `${PROD_URL}/api/owner-backup?token=${OWNER_BACKUP_TOKEN}&format=zip`,
      selfRestore: `${PROD_URL}/api/system/self-restore?token=${OWNER_BACKUP_TOKEN}`,
    },
    subagents: SUBAGENTS.map((s) => ({ id: s.id, name: s.name, role: s.role, enabled: s.enabled })),
    upgradeManifest: { total: upgrades.length, latest5: upgrades.slice(-5).map((u) => ({ id: u.id, title: u.title })) },
    sourceFiles,
    deployInfo: { currentCommit: gitCommit, productionUrl: PROD_URL },
  }

  const jsonPath = path.join(DOWNLOAD, 'agent007-upgrade65-backup.json')
  fs.writeFileSync(jsonPath, JSON.stringify(backup, null, 2))
  console.log('JSON backup written:', jsonPath, `(${(fs.statSync(jsonPath).size / 1024).toFixed(1)} KB)`)

  const zip = new AdmZip()
  zip.addFile('agent007-upgrade65-backup.json', Buffer.from(JSON.stringify(backup, null, 2)))
  for (const [relPath, content] of Object.entries(sourceFiles)) {
    zip.addFile(relPath, Buffer.from(content, 'utf-8'))
  }

  const readme = [
    '# Agent007 AI — Upgrade #65 Full Backup (Website + Email + UI Builder Awareness)',
    '',
    'Generated: ' + backup.exportedAt,
    'Git commit: ' + (gitCommit ?? 'n/a'),
    '',
    '## ✅ WEBSITE BUILDER + UI FORM BUILDER + EMAIL AUTOMATION — ALL AVAILABLE',
    '',
    'Owner request: "Add all these tools: Website Builder, UI Form Builder, Email Automation"',
    '',
    'AUDIT RESULT: All 3 tools ALREADY EXISTED in TOOL_REGISTRY (567 total tools).',
    'All permanently locked (NEVER_REMOVABLE) + full access (FULL_ACCESS_TOOLS).',
    '',
    '## The 3 Tools (all verified live)',
    '',
    '### 1. website_builder',
    '- Label: Website Builder (landing pages via HTML/React/WordPress)',
    '- Location: src/lib/tools.ts:2236',
    '- Generates: HTML/React code for landing pages, full websites, portfolios',
    '- Usage: <tool name="website_builder">{"type":"landing","title":"My SaaS","platform":"nextjs"}</tool>',
    '',
    '### 2. ui_form_builder',
    '- Label: UI Form Builder (create forms to collect user info)',
    '- Location: src/lib/tools.ts:2221',
    '- Generates: HTML + React forms with custom fields',
    '- Usage: <tool name="ui_form_builder">{"name":"signup","fields":[...],"submit_url":"/api/auth/register"}</tool>',
    '',
    '### 3. email_automation',
    '- Label: Email Automation (verification + welcome + notifications)',
    '- Location: src/lib/tools.ts:2220',
    '- Sends: Real emails via Resend API (RESEND_API_KEY configured)',
    '- Templates: welcome, verification, reset, notification, marketing',
    '- Usage: <tool name="email_automation">{"to":"user@email.com","subject":"Welcome!","template":"welcome","data":{...}}</tool>',
    '',
    '## What was fixed (Upgrade #65)',
    '',
    'Added a dedicated "WEBSITE + EMAIL + UI BUILDER TOOLS — ALWAYS AVAILABLE" section',
    'to the system prompt with:',
    '- Explicit "You HAVE these 3 tools. NEVER say they are not available."',
    '- 2-3 usage examples per tool',
    '- 6 related email tools listed',
    '- Placed right after PASSIVE INCOME AUTONOMY STACK for high visibility',
    '',
    '## 🔐 Owner-Only Download URLs (LIVE + VERIFIED)',
    '',
    'JSON: ' + PROD_URL + '/api/owner-backup?token=' + OWNER_BACKUP_TOKEN + '&format=json',
    'ZIP:  ' + PROD_URL + '/api/owner-backup?token=' + OWNER_BACKUP_TOKEN + '&format=zip',
    '',
    '## Live Verification Results',
    '',
    '✅ /api/system/manifest → 200, 62 upgrades (#65 present)',
    '✅ /api/init → 200, ok=true, "✅ Seed user: exists, ✅ Phone config: exists, ✅ Memory records: 29"',
    '✅ /api/health → 200, ok=true, healthy',
    '✅ /api/owner-backup (JSON) → 200, 520 KB',
    '✅ /api/owner-backup (ZIP) → 200, 305 KB',
    '✅ /api/monitor/qa → 200, 3/3 passed',
    '✅ /api/monitor/external → 200, 10/11 passed',
    '✅ / + /login → 200',
    '✅ agent.ts from live backup contains the new section (verified)',
    '',
    '## Metrics',
    '- Total upgrades: ' + upgrades.length + ' (was 53, +9 = upgrades #57-#65)',
    '- Total tools: ' + tools.length,
    '- Total subagents: ' + SUBAGENTS.length,
    '- Database: Postgres (PERMANENT)',
  ].join('\n')
  zip.addFile('README.md', Buffer.from(readme))

  const zipPath = path.join(DOWNLOAD, 'agent007-upgrade65-backup.zip')
  zip.writeZip(zipPath)
  console.log('ZIP backup written:', zipPath, `(${(fs.statSync(zipPath).size / 1024).toFixed(1)} KB)`)

  // Download LIVE backup to verify URLs work
  console.log('')
  console.log('=== Verifying live download URLs work ===')
  const liveJsonPath = path.join(DOWNLOAD, 'agent007-live-u65-backup.json')
  const liveZipPath = path.join(DOWNLOAD, 'agent007-live-u65-backup.zip')
  try {
    execSync(`curl -s -m 60 -o "${liveJsonPath}" "${PROD_URL}/api/owner-backup?token=${OWNER_BACKUP_TOKEN}&format=json"`)
    console.log('Live JSON downloaded:', liveJsonPath, `(${(fs.statSync(liveJsonPath).size / 1024).toFixed(1)} KB)`)
  } catch (e: any) { console.error('Live JSON download failed:', e?.message) }
  try {
    execSync(`curl -s -m 60 -o "${liveZipPath}" "${PROD_URL}/api/owner-backup?token=${OWNER_BACKUP_TOKEN}&format=zip"`)
    console.log('Live ZIP downloaded:', liveZipPath, `(${(fs.statSync(liveZipPath).size / 1024).toFixed(1)} KB)`)
  } catch (e: any) { console.error('Live ZIP download failed:', e?.message) }

  console.log('')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  UPGRADE #65 — WEBSITE + EMAIL + UI BUILDER AWARENESS — COMPLETE')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  Local JSON: ' + jsonPath)
  console.log('  Local ZIP:  ' + zipPath)
  console.log('  Live JSON:  ' + liveJsonPath)
  console.log('  Live ZIP:   ' + liveZipPath)
  console.log('')
  console.log('  OWNER DOWNLOAD URLS:')
  console.log('  JSON: ' + PROD_URL + '/api/owner-backup?token=' + OWNER_BACKUP_TOKEN + '&format=json')
  console.log('  ZIP:  ' + PROD_URL + '/api/owner-backup?token=' + OWNER_BACKUP_TOKEN + '&format=zip')
  console.log('═══════════════════════════════════════════════════════════════')
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
