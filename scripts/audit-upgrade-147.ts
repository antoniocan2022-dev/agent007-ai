/**
 * UPGRADE #147 Verification Audit
 * Verifies Rec A (resume trigger) + Rec B (CEO routing) + notification wiring.
 */
import * as fs from 'fs'
import * as path from 'path'

const baseDir = '/home/z/my-project'

interface Check {
  name: string
  file: string
  pattern: RegExp
  found: boolean
}

const checks: Check[] = [
  // Rec A — Resume Trigger
  {
    name: 'resumeMissionPipeline exported',
    file: 'src/lib/mission-pipeline.ts',
    pattern: /export async function resumeMissionPipeline/,
    found: false,
  },
  {
    name: 'approve route triggers resume',
    file: 'src/app/api/missions/[id]/approve/route.ts',
    pattern: /resumeMissionPipeline/,
    found: false,
  },
  {
    name: 'approve route has resumeTriggered flag',
    file: 'src/app/api/missions/[id]/approve/route.ts',
    pattern: /resumeTriggered:\s*true/,
    found: false,
  },
  {
    name: 'pipeline skips previously-completed stages',
    file: 'src/lib/mission-pipeline.ts',
    pattern: /previouslyCompletedStages/,
    found: false,
  },
  {
    name: 'pipeline reconstructs missionContext from prior audit log',
    file: 'src/lib/mission-pipeline.ts',
    pattern: /STAGE \$\{entry\.stageId\} OUTPUT \(from prior run\)/,
    found: false,
  },
  {
    name: 'heartbeat stores objective for resume',
    file: 'src/lib/mission-heartbeat.ts',
    pattern: /objective:\s*string/,
    found: false,
  },
  {
    name: 'heartbeat stores requiresOwnerApproval for resume',
    file: 'src/lib/mission-heartbeat.ts',
    pattern: /requiresOwnerApproval:\s*boolean/,
    found: false,
  },

  // Rec B — CEO routing through ceoPresentToOwner
  {
    name: 'CEO outcome can be "failed"',
    file: 'src/lib/mission-pipeline.ts',
    pattern: /outcome.*failed/,
    found: false,
  },
  {
    name: 'CEO outcome uses failedStages logic',
    file: 'src/lib/mission-pipeline.ts',
    pattern: /failedStages/,
    found: false,
  },
  {
    name: 'CEO persists via ceoPersistReport',
    file: 'src/lib/mission-pipeline.ts',
    pattern: /ceoPersistReport/,
    found: false,
  },
  {
    name: 'CEO sends via ceoSendTelegram',
    file: 'src/lib/mission-pipeline.ts',
    pattern: /ceoSendTelegram/,
    found: false,
  },
  {
    name: 'CEO sends via ceoSendEmail',
    file: 'src/lib/mission-pipeline.ts',
    pattern: /ceoSendEmail/,
    found: false,
  },
  {
    name: 'CEO success = outcome !== "failed"',
    file: 'src/lib/mission-pipeline.ts',
    pattern: /success:\s*outcome\s*!==\s*[\'"]failed[\'"]/,
    found: false,
  },

  // Specific notification functions wired up
  {
    name: 'notifyStageStarted imported + used',
    file: 'src/lib/mission-pipeline.ts',
    pattern: /notifyStageStarted/,
    found: false,
  },
  {
    name: 'notifyStageApproved imported + used',
    file: 'src/lib/mission-pipeline.ts',
    pattern: /notifyStageApproved/,
    found: false,
  },
  {
    name: 'notifyStageRejected imported + used',
    file: 'src/lib/mission-pipeline.ts',
    pattern: /notifyStageRejected/,
    found: false,
  },
  {
    name: 'notifyStageEscalated imported + used',
    file: 'src/lib/mission-pipeline.ts',
    pattern: /notifyStageEscalated/,
    found: false,
  },
  {
    name: 'notifyMissionStarted imported + used',
    file: 'src/lib/mission-pipeline.ts',
    pattern: /notifyMissionStarted/,
    found: false,
  },
  {
    name: 'notifyMissionFailed imported + used',
    file: 'src/lib/mission-pipeline.ts',
    pattern: /notifyMissionFailed/,
    found: false,
  },
  {
    name: 'notifyOwnerApprovalRequired imported + used',
    file: 'src/lib/mission-pipeline.ts',
    pattern: /notifyOwnerApprovalRequired/,
    found: false,
  },
  {
    name: 'notifyMissionComplete called for CEO stage',
    file: 'src/lib/mission-pipeline.ts',
    pattern: /notifyMissionComplete/,
    found: false,
  },

  // Reject flow marks heartbeat as failed
  {
    name: 'Reject flow marks heartbeat as failed',
    file: 'src/app/api/missions/[id]/approve/route.ts',
    pattern: /hb\.status\s*=\s*[\'"]failed[\'"]/,
    found: false,
  },
]

for (const c of checks) {
  const abs = path.join(baseDir, c.file)
  try {
    const content = fs.readFileSync(abs, 'utf8')
    c.found = c.pattern.test(content)
  } catch {
    c.found = false
  }
}

console.log('═══════════════════════════════════════════════════════════════')
console.log('  UPGRADE #147 Verification Audit (Rec A + Rec B + Notifications)')
console.log('═══════════════════════════════════════════════════════════════')
console.log('')

let allPassed = true
for (const c of checks) {
  const status = c.found ? '✅' : '❌'
  console.log(`  ${status} ${c.name}`)
  if (!c.found) allPassed = false
}

console.log('')
console.log('═══════════════════════════════════════════════════════════════')
console.log(`  RESULT: ${allPassed ? '✅ ALL CHECKS PASSED' : '❌ SOME CHECKS FAILED'}`)
console.log('═══════════════════════════════════════════════════════════════')

const report = {
  auditId: 'upgrade-147-verification',
  generatedAt: new Date().toISOString(),
  allPassed,
  totalChecks: checks.length,
  passed: checks.filter((c) => c.found).length,
  failed: checks.filter((c) => !c.found).length,
  checks,
}
fs.writeFileSync('/home/z/my-project/download/agent007-upgrade-147-audit.json', JSON.stringify(report, null, 2))
console.log(`\nReport saved: /home/z/my-project/download/agent007-upgrade-147-audit.json`)
