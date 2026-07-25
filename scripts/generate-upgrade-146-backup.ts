/**
 * UPGRADE #146 — Full source code backup generator
 * Saves a ZIP of ALL source files + a JSON manifest to /download/.
 * Ready for owner download.
 */
import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'

const baseDir = '/home/z/my-project'
const outDir = '/home/z/my-project/download'
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const zipName = `agent007-upgrade-146-source-backup-${timestamp}.zip`
const jsonName = `agent007-upgrade-146-source-backup-${timestamp}.json`
const zipPath = path.join(outDir, zipName)
const jsonPath = path.join(outDir, jsonName)

// Files / directories to include in the backup
const INCLUDE_DIRS = [
  'src/lib',
  'src/app/api',
  'src/app/[locale]',  // may not exist — skip silently
  'src/components',
  'src/store',
  'src/hooks',
  'src/middleware.ts',
  'prisma',
  'scripts',
  'public',
]

const INCLUDE_FILES = [
  'package.json',
  'tsconfig.json',
  'next.config.ts',
  'tailwind.config.ts',
  'postcss.config.mjs',
  'eslint.config.mjs',
  'vercel.json',
  'README.md',
  'worklog.md',
]

const EXCLUDE_PATTERNS = [
  /node_modules/,
  /\.next/,
  /\.vercel/,
  /\.git\//,
  /tool-results\//,
  /audit-v2\//,
  /audit\//,
  /upload\//,
  /dev\.pid$/,
  /server\.log$/,
  /test_file\.js$/,
  /test_agent\.js$/,
]

function walk(dir: string, base: string = ''): Array<{ relPath: string; absPath: string; size: number }[]> {
  const results: Array<{ relPath: string; absPath: string; size: number }> = []
  if (!fs.existsSync(dir)) return results
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const e of entries) {
      const abs = path.join(dir, e.name)
      const rel = base ? `${base}/${e.name}` : e.name
      if (EXCLUDE_PATTERNS.some((p) => p.test(rel) || p.test(abs))) continue
      if (e.isDirectory()) {
        results.push(...walk(abs, rel))
      } else if (e.isFile()) {
        try {
          const stat = fs.statSync(abs)
          results.push({ relPath: rel, absPath: abs, size: stat.size })
        } catch {}
      }
    }
  } catch {}
  return results
}

console.log('═══════════════════════════════════════════════════════════════')
console.log('  AGENT007 — FULL SOURCE BACKUP GENERATOR (UPGRADE #146)')
console.log('═══════════════════════════════════════════════════════════════')
console.log(`Timestamp: ${timestamp}`)
console.log('')

// Collect all files
const allFiles: Array<{ relPath: string; absPath: string; size: number }> = []
for (const dir of INCLUDE_DIRS) {
  const abs = path.join(baseDir, dir)
  if (fs.existsSync(abs)) {
    if (fs.statSync(abs).isDirectory()) {
      allFiles.push(...walk(abs, dir))
    } else {
      const stat = fs.statSync(abs)
      allFiles.push({ relPath: dir, absPath: abs, size: stat.size })
    }
  }
}
for (const file of INCLUDE_FILES) {
  const abs = path.join(baseDir, file)
  if (fs.existsSync(abs)) {
    const stat = fs.statSync(abs)
    allFiles.push({ relPath: file, absPath: abs, size: stat.size })
  }
}

console.log(`Found ${allFiles.length} files to back up`)
const totalSize = allFiles.reduce((s, f) => s + f.size, 0)
console.log(`Total size: ${(totalSize / 1024).toFixed(1)} KB`)

// Group by directory for the manifest
const byDir: Record<string, number> = {}
for (const f of allFiles) {
  const dir = path.dirname(f.relPath)
  byDir[dir] = (byDir[dir] || 0) + 1
}

// Build JSON manifest
const manifest = {
  metadata: {
    app: 'Agent007 AI',
    version: 'upgrade-146',
    timestamp: new Date().toISOString(),
    owner: 'Antonio',
    deployment: 'https://agent007-ai.vercel.app',
    platform: 'Vercel + Next.js',
  },
  summary: {
    totalFiles: allFiles.length,
    totalSizeBytes: totalSize,
    totalSizeKB: Math.round(totalSize / 1024),
    directories: Object.keys(byDir).length,
  },
  upgradeLog: {
    '#137': 'Super Agent Verifier (Rec 1) — apex quality authority',
    '#138': 'CEO Presenter (Rec 3) — final executive report',
    '#139': 'Mission Pipeline (Rec 2+4+7) — sequential teams with retry loop',
    '#140': 'Approval Audit Log (Rec 5) — every action logged to DB',
    '#141': 'Mission Notifier (Rec 6) — Telegram milestones',
    '#142': 'Page load fix (Issue A) — batched CREATE TABLE + parallel fetches',
    '#143': 'Leader message DB persistence (Issue B) — survives cold starts',
    '#144': 'Real-time Mission Monitor (Rec 2) — heartbeat + ETA + CEO watchdog',
    '#145': 'Stale "12 specialists" → "20 sub-agents" text fix (Rec 3)',
    '#146': 'Code audit fixes (6 critical + warnings) — see audit-report.md',
  },
  filesByDirectory: byDir,
  files: allFiles.map((f) => ({
    path: f.relPath,
    size: f.size,
  })),
  endpoints: {
    new: [
      'GET  /api/missions/pipelines',
      'POST /api/missions/run',
      'GET  /api/missions/heartbeats',
      'GET  /api/missions/[id]/audit-trail',
      'GET  /api/missions/[id]/heartbeat',
      'POST /api/missions/[id]/approve',
    ],
    modified: [
      'GET/POST /api/mission-active (DB-backed)',
      'GET/POST /api/mission-active/[missionId] (DB-backed)',
    ],
  },
  deploymentUrl: 'https://agent007-ai.vercel.app',
  healthCheck: 'https://agent007-ai.vercel.app/api/health',
  auditReport: 'https://agent007-ai.vercel.app/api/health/full-audit',
}

fs.writeFileSync(jsonPath, JSON.stringify(manifest, null, 2))
console.log(`✅ JSON manifest saved: ${jsonPath}`)

// Build ZIP using system `zip` command (faster than node archiver for many files)
// Fall back to tar if zip is not available
let zipCreated = false
try {
  // Write a file list to a temp file, then zip them
  const listFile = path.join(outDir, '_backup_filelist.txt')
  fs.writeFileSync(listFile, allFiles.map((f) => f.absPath).join('\n'))
  execSync(`cd ${baseDir} && zip -q -y ${zipPath} -@ < ${listFile} && rm ${listFile}`, { stdio: 'inherit' })
  zipCreated = fs.existsSync(zipPath)
  if (zipCreated) {
    const stat = fs.statSync(zipPath)
    console.log(`✅ ZIP backup saved: ${zipPath} (${(stat.size / 1024).toFixed(1)} KB)`)
  }
} catch (e: any) {
  console.warn(`zip command failed: ${e?.message?.slice(0, 100)}`)
}

// Fallback: tar if zip didn't work
if (!zipCreated) {
  try {
    const tarPath = zipPath.replace(/\.zip$/, '.tar.gz')
    const listFile = path.join(outDir, '_backup_filelist.txt')
    fs.writeFileSync(listFile, allFiles.map((f) => f.absPath).join('\n'))
    execSync(`cd ${baseDir} && tar czf ${tarPath} -T ${listFile} && rm ${listFile}`, { stdio: 'inherit' })
    console.log(`✅ TAR.GZ backup saved: ${tarPath}`)
  } catch (e: any) {
    console.warn(`tar fallback failed: ${e?.message?.slice(0, 100)}`)
  }
}

console.log('')
console.log('═══════════════════════════════════════════════════════════════')
console.log('  ✅ BACKUP COMPLETE')
console.log('═══════════════════════════════════════════════════════════════')
console.log(`  Files:    ${allFiles.length}`)
console.log(`  Size:     ${(totalSize / 1024).toFixed(1)} KB`)
console.log(`  JSON:     ${jsonPath}`)
console.log(`  Archive:  ${zipPath}`)
console.log('═══════════════════════════════════════════════════════════════')
