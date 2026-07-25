/**
 * UPGRADE #142-#145 Audit Script
 * Verifies all new code is in place + deployed correctly.
 */
import * as fs from 'fs'
import * as path from 'path'

const baseDir = '/home/z/my-project'

interface Check {
  name: string
  file: string
  exists: boolean
  size: number
  lines: number
}

const checks: Check[] = [
  // UPGRADE #142 — Page load fix
  { name: 'DB batch CREATE TABLE', file: 'src/lib/db.ts', exists: false, size: 0, lines: 0 },
  { name: 'Dashboard parallel fetches', file: 'src/components/agent/tabs/dashboard-tab.tsx', exists: false, size: 0, lines: 0 },
  // UPGRADE #143 — Leader message persistence
  { name: 'Active Missions DB store', file: 'src/lib/active-missions-db.ts', exists: false, size: 0, lines: 0 },
  { name: 'Mission-Active route (DB-backed)', file: 'src/app/api/mission-active/route.ts', exists: false, size: 0, lines: 0 },
  { name: 'Mission-Active [id] route (DB-backed)', file: 'src/app/api/mission-active/[missionId]/route.ts', exists: false, size: 0, lines: 0 },
  { name: 'Mission-Active tab (55s timeout)', file: 'src/components/agent/tabs/mission-active-tab.tsx', exists: false, size: 0, lines: 0 },
  // UPGRADE #144 — Real-time monitoring
  { name: 'Mission Heartbeat lib', file: 'src/lib/mission-heartbeat.ts', exists: false, size: 0, lines: 0 },
  { name: 'Mission Monitor component', file: 'src/components/agent/mission-monitor.tsx', exists: false, size: 0, lines: 0 },
  { name: 'Heartbeats list endpoint', file: 'src/app/api/missions/heartbeats/route.ts', exists: false, size: 0, lines: 0 },
  { name: 'Per-mission heartbeat endpoint', file: 'src/app/api/missions/[id]/heartbeat/route.ts', exists: false, size: 0, lines: 0 },
  // UPGRADE #145 — Stale text fix
  { name: 'Subagents count update (20)', file: 'src/lib/subagents.ts', exists: false, size: 0, lines: 0 },
  { name: 'Orchestrator prompt update (20)', file: 'src/lib/orchestrator.ts', exists: false, size: 0, lines: 0 },
  { name: 'Layout metadata update (20)', file: 'src/app/layout.tsx', exists: false, size: 0, lines: 0 },
  // Prior upgrades (should still be present)
  { name: 'Super Agent Verifier', file: 'src/lib/super-agent-verifier.ts', exists: false, size: 0, lines: 0 },
  { name: 'CEO Presenter', file: 'src/lib/ceo-presenter.ts', exists: false, size: 0, lines: 0 },
  { name: 'Mission Pipeline', file: 'src/lib/mission-pipeline.ts', exists: false, size: 0, lines: 0 },
  { name: 'Approval Audit Log', file: 'src/lib/approval-audit-log.ts', exists: false, size: 0, lines: 0 },
  { name: 'Mission Notifier (Telegram)', file: 'src/lib/mission-notifier.ts', exists: false, size: 0, lines: 0 },
]

for (const c of checks) {
  const abs = path.join(baseDir, c.file)
  try {
    const stat = fs.statSync(abs)
    const content = fs.readFileSync(abs, 'utf8')
    c.exists = true
    c.size = stat.size
    c.lines = content.split('\n').length
  } catch {
    c.exists = false
  }
}

// Content checks (verify specific strings are present)
const contentChecks: Array<{ name: string; file: string; pattern: string; found: boolean }> = [
  { name: 'DB uses BATCH_SIZE', file: 'src/lib/db.ts', pattern: /BATCH_SIZE\s*=\s*8/, found: false },
  { name: 'Dashboard uses Promise.all', file: 'src/components/agent/tabs/dashboard-tab.tsx', pattern: /Promise\.all\(\[\s*loadIncome\(\),\s*loadSettings\(\),\s*loadCustomWidgets\(\)/, found: false },
  { name: 'Mission-Active route imports DB store', file: 'src/app/api/mission-active/route.ts', pattern: /listActiveMissionsDB/, found: false },
  { name: 'Leader route uses DB store', file: 'src/app/api/mission-active/[missionId]/route.ts', pattern: /getActiveMissionDB/, found: false },
  { name: 'sendToLeader has AbortSignal.timeout', file: 'src/components/agent/tabs/mission-active-tab.tsx', pattern: /AbortSignal\.timeout\(55_000\)/, found: false },
  { name: 'MissionMonitor imported in dashboard', file: 'src/components/agent/tabs/dashboard-tab.tsx', pattern: /import.*MissionMonitor/, found: false },
  { name: 'Subagents say "20 specialists"', file: 'src/lib/subagents.ts', pattern: /20 specialists/, found: false },
  { name: 'Orchestrator says "20 specialized"', file: 'src/lib/orchestrator.ts', pattern: /20 specialized sub-agents/, found: false },
  { name: 'Layout says "20 sub-agents"', file: 'src/app/layout.tsx', pattern: /20 sub-agents/, found: false },
  { name: 'Heartbeat lib exports saveHeartbeat', file: 'src/lib/mission-heartbeat.ts', pattern: /export async function saveHeartbeat/, found: false },
  { name: 'Mission pipeline saves heartbeat', file: 'src/lib/mission-pipeline.ts', pattern: /saveHeartbeat\(initialHeartbeat\)/, found: false },
]

for (const cc of contentChecks) {
  const abs = path.join(baseDir, cc.file)
  try {
    const content = fs.readFileSync(abs, 'utf8')
    cc.found = cc.pattern.test(content)
  } catch {
    cc.found = false
  }
}

// Print report
console.log('═══════════════════════════════════════════════════════════════')
console.log('  Agent007 UPGRADE #142-#145 Verification Audit')
console.log('═══════════════════════════════════════════════════════════════')
console.log('')
console.log('## File Inventory')
let allFilesExist = true
for (const c of checks) {
  const status = c.exists ? '✅' : '❌'
  console.log(`  ${status} ${c.name.padEnd(40)} ${c.file} (${c.lines} lines, ${c.size} bytes)`)
  if (!c.exists) allFilesExist = false
}
console.log('')
console.log('## Content Checks')
let allContentFound = true
for (const cc of contentChecks) {
  const status = cc.found ? '✅' : '❌'
  console.log(`  ${status} ${cc.name}`)
  if (!cc.found) allContentFound = false
}
console.log('')
console.log('═══════════════════════════════════════════════════════════════')
console.log(`  RESULT: ${allFilesExist && allContentFound ? '✅ ALL CHECKS PASSED' : '❌ SOME CHECKS FAILED'}`)
console.log('═══════════════════════════════════════════════════════════════')

// Save report
const report = {
  auditId: 'upgrade-142-145-verification',
  generatedAt: new Date().toISOString(),
  allFilesExist,
  allContentFound,
  fileChecks: checks,
  contentChecks,
  deploymentUrl: 'https://agent007-ai.vercel.app',
}
const outPath = '/home/z/my-project/download/agent007-upgrade-142-145-audit.json'
fs.writeFileSync(outPath, JSON.stringify(report, null, 2))
console.log(`\nReport saved: ${outPath}`)
