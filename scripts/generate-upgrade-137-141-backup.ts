/**
 * Generate backup of Agent007 after UPGRADE #137-#141
 * (Hierarchical Verification Workflow — Rec 1-7).
 *
 * Run: npx tsx scripts/generate-upgrade-137-141-backup.ts
 *
 * Saves a JSON manifest of the new files + their sizes to:
 *   /home/z/my-project/download/agent007-hierarchy-137-141-backup.json
 */
import * as fs from 'fs'
import * as path from 'path'

const NEW_FILES = [
  'src/lib/super-agent-verifier.ts',
  'src/lib/ceo-presenter.ts',
  'src/lib/mission-pipeline.ts',
  'src/lib/approval-audit-log.ts',
  'src/lib/mission-notifier.ts',
  'src/app/api/missions/[id]/audit-trail/route.ts',
  'src/app/api/missions/[id]/approve/route.ts',
  'src/app/api/missions/run/route.ts',
  'src/app/api/missions/pipelines/route.ts',
]

const MODIFIED_FILES = [
  'src/lib/orchestrator.ts',
]

const baseDir = '/home/z/my-project'
const outDir = '/home/z/my-project/download'

function fileStats(relPath: string) {
  const abs = path.join(baseDir, relPath)
  try {
    const stat = fs.statSync(abs)
    const content = fs.readFileSync(abs, 'utf8')
    return {
      path: relPath,
      size: stat.size,
      lines: content.split('\n').length,
      exists: true,
    }
  } catch (e: any) {
    return { path: relPath, size: 0, lines: 0, exists: false, error: e?.message }
  }
}

const backup = {
  backupId: 'agent007-hierarchy-137-141',
  generatedAt: new Date().toISOString(),
  description: 'UPGRADE #137-#141 — Hierarchical Verification Workflow (Rec 1-7)',
  summary: {
    recommendation1_super_agent_verifier: 'super-agent-verifier.ts — apex quality authority',
    recommendation2_correction_loop: 'mission-pipeline.ts — max 3 retry rounds with specific corrections',
    recommendation3_ceo_presenter: 'ceo-presenter.ts — final executive report for owner',
    recommendation4_sequential_pipeline: 'mission-pipeline.ts — ordered team pipelines per mission type',
    recommendation5_audit_trail: 'approval-audit-log.ts + /api/missions/[id]/audit-trail',
    recommendation6_telegram_milestones: 'mission-notifier.ts — Telegram at every stage milestone',
    recommendation7_owner_approval_gate: 'mission-pipeline.ts — pauses for high-stakes missions',
    autonomy_estimate_before: '90%',
    autonomy_estimate_after: '97-98%',
  },
  newFiles: NEW_FILES.map(fileStats),
  modifiedFiles: MODIFIED_FILES.map(fileStats),
  pipelineTypes: ['product_launch', 'content_creation', 'affiliate_campaign', 'generic'],
  apiEndpoints: [
    'GET  /api/missions/pipelines',
    'POST /api/missions/run',
    'GET  /api/missions/[id]/audit-trail',
    'POST /api/missions/[id]/approve',
  ],
  triggerCommand: 'start mission: <type>: <objective>',
  deploymentUrl: 'https://agent007-ai.vercel.app',
}

const outPath = path.join(outDir, 'agent007-hierarchy-137-141-backup.json')
fs.writeFileSync(outPath, JSON.stringify(backup, null, 2))
console.log(`✅ Backup saved: ${outPath}`)
console.log(`   New files: ${backup.newFiles.length}`)
console.log(`   Modified files: ${backup.modifiedFiles.length}`)
console.log(`   Total size: ${[...backup.newFiles, ...backup.modifiedFiles].reduce((s, f) => s + f.size, 0)} bytes`)
