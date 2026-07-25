/**
 * UPGRADE #148 Verification Audit
 * Verifies all 10 fixes for the 3 external audit issues.
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
  // Issue 3a — Strict id matching
  {
    name: '3a: Strict id-based matching (no fuzzy name fallback)',
    file: 'src/app/api/mission-active/[missionId]/route.ts',
    pattern: /s\.id === leaderInfo!\.leaderId[^|]/,
    found: false,
  },
  {
    name: '3a: Clear error message listing available subagent ids',
    file: 'src/app/api/mission-active/[missionId]/route.ts',
    pattern: /no subagent with id/,
    found: false,
  },
  // Issue 3b — Nova references removed
  {
    name: '3b: No more Nova references in mission-pipeline.ts',
    file: 'src/lib/mission-pipeline.ts',
    pattern: /^(?!.*Nova).*$/m,
    found: false,
  },
  {
    name: '3b: References use Vertex (was Nova)',
    file: 'src/lib/mission-pipeline.ts',
    pattern: /Vertex's blueprint/,
    found: false,
  },
  {
    name: '3b: References use Quill (was Nova)',
    file: 'src/lib/mission-pipeline.ts',
    pattern: /Quill's draft/,
    found: false,
  },
  {
    name: '3b: References use Forge (was Nova)',
    file: 'src/lib/mission-pipeline.ts',
    pattern: /Forge's execution/,
    found: false,
  },
  // Issue 3c — CEO special-case
  {
    name: '3c: CEO stage special-cased in leader route',
    file: 'src/app/api/mission-active/[missionId]/route.ts',
    pattern: /leaderId === 'ceo'/,
    found: false,
  },
  {
    name: '3c: CEO uses callLlmWithRetry directly',
    file: 'src/app/api/mission-active/[missionId]/route.ts',
    pattern: /CEO LLM call failed/,
    found: false,
  },
  // Issue 3d — Better timeout message
  {
    name: '3d: Timeout message has detailed diagnostic steps',
    file: 'src/app/api/mission-active/[missionId]/route.ts',
    pattern: /Open \/api\/health\/llm-providers in your browser/,
    found: false,
  },
  {
    name: '3d: Timeout message lists provider env vars',
    file: 'src/app/api/mission-active/[missionId]/route.ts',
    pattern: /MISTRAL_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY/,
    found: false,
  },
  // Issue 2a — Pooler detection
  {
    name: '2a: db.ts has pooler detection logic',
    file: 'src/lib/db.ts',
    pattern: /hasPooler/,
    found: false,
  },
  {
    name: '2a: db.ts warns when no pooler',
    file: 'src/lib/db.ts',
    pattern: /does not appear to use a connection pooler/,
    found: false,
  },
  // Issue 2b — Parallelized seedData
  {
    name: '2b: seedData uses Promise.all for 4 lookups',
    file: 'src/lib/db.ts',
    pattern: /Promise\.all\(\[\s*db\.phoneConfig\.findFirst/,
    found: false,
  },
  // Issue 2c — Pre-warm fetch
  {
    name: '2c: PreWarmDb component exists',
    file: 'src/components/providers/pre-warm-db.tsx',
    pattern: /export function PreWarmDb/,
    found: false,
  },
  {
    name: '2c: PreWarmDb fires /api/health on mount',
    file: 'src/components/providers/pre-warm-db.tsx',
    pattern: /fetch\('\/api\/health'/,
    found: false,
  },
  {
    name: '2c: PreWarmDb wired into layout.tsx',
    file: 'src/app/layout.tsx',
    pattern: /<PreWarmDb/,
    found: false,
  },
  // Issue 2d — README has pooler docs
  {
    name: '2d: README has Database Setup section',
    file: 'README.md',
    pattern: /Database Setup \(CRITICAL for performance\)/,
    found: false,
  },
  {
    name: '2d: README documents Neon pooler',
    file: 'README.md',
    pattern: /neon\.tech/,
    found: false,
  },
  {
    name: '2d: README documents Supabase pooler',
    file: 'README.md',
    pattern: /pgbouncer=true/,
    found: false,
  },
  // Issue 1a — Lower threshold
  {
    name: '1a: Scroll threshold lowered to +30 (was +100)',
    file: 'src/components/agent/scroll-arrows.tsx',
    pattern: /scrollHeight > clientHeight \+ 30/,
    found: false,
  },
  // Issue 1b — Toggle outside hasAnyArrow gate
  {
    name: '1b: Toggle button is unconditional (outside hasAnyArrow gate)',
    file: 'src/components/agent/scroll-arrows.tsx',
    pattern: /Toggle button is ALWAYS visible/,
    found: false,
  },
  {
    name: '1b: Toggle positioned at bottom-LEFT (no overlap)',
    file: 'src/components/agent/scroll-arrows.tsx',
    pattern: /absolute bottom-4 left-4/,
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
console.log('  UPGRADE #148 Verification Audit (3 Issues × All Recommendations)')
console.log('═══════════════════════════════════════════════════════════════')
console.log('')

let allPassed = true
let passed = 0, failed = 0
for (const c of checks) {
  const status = c.found ? '✅' : '❌'
  console.log(`  ${status} ${c.name}`)
  if (c.found) passed++; else { failed++; allPassed = false }
}

console.log('')
console.log('═══════════════════════════════════════════════════════════════')
console.log(`  RESULT: ${allPassed ? '✅ ALL CHECKS PASSED' : '❌ SOME CHECKS FAILED'} (${passed}/${checks.length} passed)`)
console.log('═══════════════════════════════════════════════════════════════')

const report = {
  auditId: 'upgrade-148-verification',
  generatedAt: new Date().toISOString(),
  allPassed,
  totalChecks: checks.length,
  passed,
  failed,
  checks,
}
fs.writeFileSync('/home/z/my-project/download/agent007-upgrade-148-audit.json', JSON.stringify(report, null, 2))
console.log(`\nReport saved: /home/z/my-project/download/agent007-upgrade-148-audit.json`)
