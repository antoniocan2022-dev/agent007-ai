/**
 * UPGRADE #210 — DEEP AUDIT OF PROMPT SYSTEM + ALL RECENT FIXES
 * Focus: errors, duplicate files, broken files, anomalies, inconsistencies
 * introduced by #197 through #209 (50 hours of changes)
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'

const SRC = '/home/z/my-project/src'
const ROOT = '/home/z/my-project'
let errors = 0
let warnings = 0
const findings: string[] = []

function err(cat: string, msg: string) {
  errors++
  findings.push(`❌ [${cat}] ${msg}`)
  console.log(`❌ [${cat}] ${msg}`)
}
function warn(cat: string, msg: string) {
  warnings++
  findings.push(`⚠️  [${cat}] ${msg}`)
  console.log(`⚠️  [${cat}] ${msg}`)
}
function ok(cat: string, msg: string) {
  console.log(`✅ [${cat}] ${msg}`)
}

console.log('═══════════════════════════════════════════════════════════════════')
console.log('  DEEP AUDIT — PROMPT SYSTEM + ALL FIXES #197-#209')
console.log('═══════════════════════════════════════════════════════════════════')
console.log()

// ═══ 1. TypeScript errors ═══
console.log('─ 1. TypeScript Compilation ─')
try {
  const output = execSync('npx tsc --noEmit 2>&1', { cwd: ROOT, encoding: 'utf-8', timeout: 60000 })
  const tsErrors = output.split('\n').filter(l => l.startsWith('src/'))
  if (tsErrors.length === 0) ok('TypeScript', '0 errors')
  else tsErrors.slice(0, 10).forEach(e => err('TypeScript', e.trim()))
} catch (e: any) {
  const output = e.stdout || e.message || ''
  const tsErrors = output.split('\n').filter((l: string) => l.startsWith('src/'))
  if (tsErrors.length === 0) ok('TypeScript', '0 errors')
  else tsErrors.slice(0, 10).forEach((e: string) => err('TypeScript', e.trim()))
}
console.log()

// ═══ 2. Check for broken imports (from PII replacement) ═══
console.log('─ 2. Broken Imports (from PII replacement) ─')
function walk(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) files.push(...walk(full))
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) files.push(full)
  }
  return files
}

const allFiles = walk(SRC)
let brokenImports = 0
for (const file of allFiles) {
  const src = readFileSync(file, 'utf-8')
  // Check for imports inserted mid-line (from the PII script bug)
  const lines = src.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Pattern: word + "import { OWNER_" in the middle of a line
    if (/from\s+['"]@\/lib\/owner-config['"]/.test(line) && !line.trim().startsWith('import')) {
      // Check if it's a continuation of a previous line (broken)
      if (!line.includes('} from') && i > 0) {
        err('BrokenImport', `${file.replace(SRC + '/', '')}:${i+1} — import not on its own line`)
        brokenImports++
      }
    }
  }
}
if (brokenImports === 0) ok('BrokenImports', 'No broken imports from PII replacement')
console.log()

// ═══ 3. Check SYSTEM_PROMPT for contradictions ═══
console.log('─ 3. SYSTEM_PROMPT Contradictions ─')
const agentSrc = readFileSync(join(SRC, 'lib/agent.ts'), 'utf8')
const promptChecks = [
  { name: 'Says "20 pod leaders"', rx: /20 pod leaders/, shouldExist: true },
  { name: 'Says "18 pod leaders" (old)', rx: /18 pod leaders/, shouldExist: false },
  { name: 'Has CALIBRATED CONFIDENCE', rx: /CALIBRATED CONFIDENCE/, shouldExist: true },
  { name: 'Has anti-consulting rule #9', rx: /NEVER recommend building something you already have/, shouldExist: true },
  { name: 'Has ACT rule #10', rx: /ACT, don/, shouldExist: true },
  { name: 'Has third-person rule #11', rx: /Never describe yourself in the third person/, shouldExist: true },
  { name: 'Has KB search rule #12', rx: /kb_search.*charter/, shouldExist: true },
  { name: 'Has EXAMPLE EXCHANGES', rx: /EXAMPLE EXCHANGES/, shouldExist: true },
  { name: 'Old "ALWAYS" greeting (should be gone)', rx: /EVERY response.*ALWAYS/, shouldExist: false },
  { name: 'Old "Let\'s dive" ban', rx: /Let\\*'s dive into/, shouldExist: true },
]
for (const c of promptChecks) {
  const found = c.rx.test(agentSrc)
  if (c.shouldExist) {
    if (found) ok('SystemPrompt', `${c.name} — present`)
    else err('SystemPrompt', `${c.name} — MISSING`)
  } else {
    if (!found) ok('SystemPrompt', `${c.name} — correctly absent`)
    else err('SystemPrompt', `${c.name} — should NOT exist`)
  }
}
console.log()

// ═══ 4. Check orchestrator identity reminder ═══
console.log('─ 4. Orchestrator Identity Reminder ─')
const orchSrc = readFileSync(join(SRC, 'lib/orchestrator.ts'), 'utf8')
const orchChecks = [
  { name: 'Says "20 pod leaders"', rx: /20 pod leaders/, shouldExist: true },
  { name: 'Says "18 pod leaders" (old)', rx: /18 pod leaders/, shouldExist: false },
  { name: 'Has anti-consulting', rx: /Never recommend building tools you already have/, shouldExist: true },
  { name: 'Has third-person ban', rx: /Never describe yourself in the third person/, shouldExist: true },
  { name: 'Has strategic question detection', rx: /STRATEGIC_KEYWORDS/, shouldExist: true },
  { name: 'Has auto-diagnostics', rx: /SYSTEM STATUS REPORT/, shouldExist: true },
]
for (const c of orchChecks) {
  const found = c.rx.test(orchSrc)
  if (c.shouldExist) {
    if (found) ok('Orchestrator', `${c.name} — present`)
    else err('Orchestrator', `${c.name} — MISSING`)
  } else {
    if (!found) ok('Orchestrator', `${c.name} — correctly absent`)
    else err('Orchestrator', `${c.name} — should NOT exist`)
  }
}
console.log()

// ═══ 5. Check subagents for consistency ═══
console.log('─ 5. Subagent Consistency ─')
const subSrc = readFileSync(join(SRC, 'lib/subagents.ts'), 'utf8')
const subChecks = [
  { name: 'Has qa_monitor (renamed from testfast2)', rx: /id: 'qa_monitor'/, shouldExist: true },
  { name: 'Has external_uptime_monitor (renamed from fasttest3)', rx: /id: 'external_uptime_monitor'/, shouldExist: true },
  { name: 'No testfast2 ID', rx: /id: 'testfast2'/, shouldExist: false },
  { name: 'No fasttest3 ID', rx: /id: 'fasttest3'/, shouldExist: false },
  { name: 'Has THINKING PROTOCOL (#204)', rx: /THINKING PROTOCOL/, shouldExist: true },
  { name: 'Has CROSS-POD DISPATCH (#204)', rx: /CROSS-POD DISPATCH/, shouldExist: true },
  { name: 'No FULL_ACCESS + multi_provider double-add', rx: /FULL_ACCESS_TOOLS.*'multi_provider_compare'/, shouldExist: false },
]
for (const c of subChecks) {
  const found = c.rx.test(subSrc)
  if (c.shouldExist) {
    if (found) ok('Subagents', `${c.name} — present`)
    else err('Subagents', `${c.name} — MISSING`)
  } else {
    if (!found) ok('Subagents', `${c.name} — correctly absent`)
    else err('Subagents', `${c.name} — should NOT exist`)
  }
}
console.log()

// ═══ 6. Check for hardcoded PII ═══
console.log('─ 6. Hardcoded PII ─')
let piiCount = 0
for (const file of allFiles) {
  if (file.includes('owner-config.ts') || file.includes('upgrade-manifest.ts') || file.includes('.bak')) continue
  const src = readFileSync(file, 'utf-8')
  const lines = src.split('\n')
  lines.forEach((line, i) => {
    if (line.includes('antonio.can2022@hotmail.com') && !line.trim().startsWith('//') && !line.trim().startsWith('*')) {
      err('HardcodedPII', `${file.replace(SRC + '/', '')}:${i+1} — email in executable code`)
      piiCount++
    }
    if (line.includes('+15145496297') && !line.trim().startsWith('//') && !line.trim().startsWith('*')) {
      err('HardcodedPII', `${file.replace(SRC + '/', '')}:${i+1} — phone in executable code`)
      piiCount++
    }
  })
}
if (piiCount === 0) ok('HardcodedPII', 'No hardcoded email/phone in executable code')
console.log()

// ═══ 7. Check TOOL_REGISTRY for duplicates ═══
console.log('─ 7. TOOL_REGISTRY Duplicates ─')
const toolsSrc = readFileSync(join(SRC, 'lib/tools.ts'), 'utf8')
const toolMatches = toolsSrc.match(/^TOOL_REGISTRY\.\w+/gm) || []
const toolSeen = new Map<string, number>()
for (const t of toolMatches) {
  const name = t.replace('TOOL_REGISTRY.', '')
  toolSeen.set(name, (toolSeen.get(name) || 0) + 1)
}
const toolDups = [...toolSeen.entries()].filter(([_, n]) => n > 1)
if (toolDups.length === 0) ok('ToolRegistry', `No duplicates (${toolMatches.length} unique)`)
else toolDups.forEach(([name, n]) => err('ToolRegistry', `${name}: ${n} duplicates`))
console.log()

// ═══ 8. Check new #209 files exist and compile ═══
console.log('─ 8. #209 Feature Files ─')
const newFiles = [
  'src/lib/autonomous-strategic-planner.ts',
  'src/lib/leader-debate.ts',
  'src/lib/mission-os.ts',
  'src/app/api/system/morning-brief/route.ts',
  'src/app/api/schedules/morning-brief/route.ts',
  'src/app/api/system/debate/route.ts',
  'src/app/api/system/mission/route.ts',
]
for (const f of newFiles) {
  const fullPath = join(ROOT, f)
  if (existsSync(fullPath)) {
    const stat = statSync(fullPath)
    ok('NewFiles', `${f} (${stat.size} bytes)`)
  } else {
    err('NewFiles', `${f} — MISSING`)
  }
}
console.log()

// ═══ 9. Check vercel.json crons ═══
console.log('─ 9. Vercel Cron Config ─')
const vercelJson = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf-8'))
const crons = vercelJson.crons || []
const expectedCrons = ['/api/schedules/tick', '/api/monitor/qa', '/api/monitor/external', '/api/schedules/morning-brief']
for (const expected of expectedCrons) {
  if (crons.some(c => c.path === expected)) {
    ok('Cron', `${expected} — present`)
  } else {
    err('Cron', `${expected} — MISSING`)
  }
}
console.log()

// ═══ 10. Check middleware whitelist ═══
console.log('─ 10. Middleware Whitelist ─')
const middlewareSrc = readFileSync(join(SRC, 'middleware.ts'), 'utf8')
const whitelistChecks = [
  'system/morning-brief',
  'system/debate',
  'system/mission',
  'schedules/morning-brief',
  'backup/download-source',
  'tools/test',
]
for (const path of whitelistChecks) {
  if (middlewareSrc.includes(path)) {
    ok('Middleware', `${path} — whitelisted`)
  } else {
    err('Middleware', `${path} — NOT whitelisted (will redirect to login)`)
  }
}
console.log()

// ═══ 11. Check version label ═══
console.log('─ 11. Version Label ─')
const healthSrc = readFileSync(join(SRC, 'app/api/health/route.ts'), 'utf8')
const versionMatch = healthSrc.match(/version:\s*'([^']+)'/)
if (versionMatch) ok('Version', `Local: ${versionMatch[1]}`)
else err('Version', 'Version label not found')
console.log()

// ═══ 12. Check for empty catch blocks ═══
console.log('─ 12. Empty Catch Blocks ─')
let emptyCatchCount = 0
for (const file of allFiles) {
  const src = readFileSync(file, 'utf-8')
  const matches = src.match(/catch\s*(?:\([^)]*\))?\s*\{\s*\}/g) || []
  if (matches.length > 0) {
    warn('EmptyCatch', `${file.replace(SRC + '/', '')}: ${matches.length} empty catches`)
    emptyCatchCount += matches.length
  }
}
if (emptyCatchCount === 0) ok('EmptyCatch', 'No empty catch blocks')
console.log()

// ═══ SUMMARY ═══
console.log('═══════════════════════════════════════════════════════════════════')
console.log(`  AUDIT COMPLETE — ${errors} errors, ${warnings} warnings`)
console.log('═══════════════════════════════════════════════════════════════════')
if (errors > 0) {
  console.log()
  console.log('ERRORS:')
  findings.filter(f => f.startsWith('❌')).forEach(f => console.log(`  ${f}`))
}
process.exit(errors > 0 ? 1 : 0)
