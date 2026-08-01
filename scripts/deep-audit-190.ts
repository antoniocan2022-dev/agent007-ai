/**
 * DEEP AUDIT — #190 + SYSTEM_PROMPT integrity + duplicate files + fake tools
 * Run: npx tsx /home/z/my-project/scripts/deep-audit-190.ts
 */
import { readdirSync, statSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'

const ROOT = '/home/z/my-project/src'

console.log('═══════════════════════════════════════════════════════════════════')
console.log('AUDIT 1: SYSTEM_PROMPT internal contradictions')
console.log('═══════════════════════════════════════════════════════════════════')

const agentSrc = readFileSync(join(ROOT, 'lib/agent.ts'), 'utf8')

// Extract just the SYSTEM_PROMPT template literal
const m = agentSrc.match(/export const SYSTEM_PROMPT = `([\s\S]+?)`/)
if (m) {
  const prompt = m[1]
  const lines = prompt.split('\n')

  const checks = [
    { name: 'Calibrated greeting (line ~47)', rx: /Greet Antonio naturally/i },
    { name: 'Forced greeting ALWAYS (CONTRADICTS)', rx: /Greet Antonio by name in EVERY response.*ALWAYS/i },
    { name: 'CALIBRATED CONFIDENCE keyword', rx: /CALIBRATED CONFIDENCE/i },
    { name: 'Be HONEST about the mission', rx: /Be HONEST about the mission/i },
    { name: 'OLD: ALWAYS start with Antonio', rx: /ALWAYS start with Antonio/i },
    { name: 'OLD: Be CONFIDENT (no calibrated)', rx: /\bBe CONFIDENT\b/i },
    { name: '$20K/mo mentioned (count)', rx: /\$20K/gi },
  ]

  for (const c of checks) {
    const matches = prompt.match(new RegExp(c.rx.source, c.rx.flags.replace('g','') + 'g')) || []
    console.log(`  ${matches.length > 0 ? '✓' : '✗'} ${c.name}: ${matches.length} match(es)`)
  }

  // Show line numbers for the two contradictory lines
  lines.forEach((line, i) => {
    if (/Greet Antonio naturally/i.test(line)) {
      console.log(`    [L${i+1}] NEW: ${line.trim().slice(0,100)}`)
    }
    if (/Greet Antonio by name in EVERY response/i.test(line)) {
      console.log(`    [L${i+1}] OLD: ${line.trim().slice(0,100)}`)
    }
  })
}

console.log('\n═══════════════════════════════════════════════════════════════════')
console.log('AUDIT 2: TOOL_REGISTRY count vs SYSTEM_PROMPT claim')
console.log('═══════════════════════════════════════════════════════════════════')

const toolsSrc = readFileSync(join(ROOT, 'lib/tools.ts'), 'utf8')
const toolRegMatches = toolsSrc.match(/^TOOL_REGISTRY\.\w+/gm) || []
console.log(`  Direct TOOL_REGISTRY assignments in tools.ts: ${toolRegMatches.length}`)

// Check for duplicates in the registry assignments
const seen = new Map<string, number>()
for (const t of toolRegMatches) {
  const name = t.replace('TOOL_REGISTRY.', '')
  seen.set(name, (seen.get(name) || 0) + 1)
}
const dups = [...seen.entries()].filter(([_, n]) => n > 1)
if (dups.length > 0) {
  console.log(`  ⚠️  DUPLICATE tool registrations:`)
  for (const [name, n] of dups) {
    console.log(`    - ${name}: ${n}×`)
  }
} else {
  console.log(`  ✓ No duplicates in TOOL_REGISTRY assignments`)
}

// Also check other files for TOOL_REGISTRY assignments
const libDir = join(ROOT, 'lib')
const libFiles = readdirSync(libDir).filter(f => f.endsWith('.ts') && f !== 'tools.ts')
let externalRegs = 0
for (const f of libFiles) {
  const src = readFileSync(join(libDir, f), 'utf8')
  const matches = src.match(/^TOOL_REGISTRY\.\w+/gm) || []
  if (matches.length > 0) {
    console.log(`  + ${f}: ${matches.length} TOOL_REGISTRY assignments`)
    externalRegs += matches.length
  }
}
console.log(`  Total external (non-tools.ts) registrations: ${externalRegs}`)
console.log(`  GRAND TOTAL tool registrations: ${toolRegMatches.length + externalRegs}`)

console.log('\n═══════════════════════════════════════════════════════════════════')
console.log('AUDIT 3: Subagent count vs "20 pod leaders" claim')
console.log('═══════════════════════════════════════════════════════════════════')

const subSrc = readFileSync(join(ROOT, 'lib/subagents.ts'), 'utf8')
const subIds = subSrc.match(/^\s*id:\s*'([^']+)'/gm) || []
const ids = subIds.map(s => s.match(/'([^']+)'/)?.[1]).filter(Boolean) as string[]
console.log(`  Built-in subagents in subagents.ts: ${ids.length}`)
console.log(`  IDs: ${ids.join(', ')}`)
console.log(`  SYSTEM_PROMPT claim: "20 pod leaders"`)
console.log(`  Discrepancy: ${20 - ids.length} (prompt claims more than exist)`)

// Check test-named subagents
const testSubs = ids.filter(id => /test|fast|tmp|debug/i.test(id))
if (testSubs.length > 0) {
  console.log(`  ⚠️  Test/debug subagents in production:`)
  for (const id of testSubs) console.log(`    - ${id}`)
}

console.log('\n═══════════════════════════════════════════════════════════════════')
console.log('AUDIT 4: Duplicate / suspicious file pairs in src/lib')
console.log('═══════════════════════════════════════════════════════════════════')

// Group files by likely purpose
const groups = {
  'agent core':      ['agent.ts', 'agent007-extensions.ts', 'agent007-meta.ts'],
  'orchestrator':    ['orchestrator.ts'],
  'subagents':       ['subagents.ts', 'subagent-enhancements.ts', 'subagent-max-performance.ts'],
  'real_*':          ['real-intelligence-tools.ts', 'real-integrations.ts', 'real-integrations-v2.ts', 'reality-action-mode.ts', 'reality-gate.ts'],
  'intelligence_*':  ['intelligence-tools.ts', 'intelligence-tools-v3.ts', 'tool-intelligence.ts', 'provider-intelligence.ts'],
  'tools_*':         ['tools.ts', 'tool-cache.ts', 'tool-protection.ts', 'tool-real-enhancements.ts', 'tool-testing-coordination.ts', 'tool-action-verification.ts', 'tool-self-repair-engine.ts'],
  'performance_*':   ['performance-booster-tools.ts', 'performance-enhancement-tools.ts'],
  'optimization_*':  ['optimization-tools-v2.ts'],
  'autonomy_*':      ['autonomy-tools.ts', 'max-autonomy-engine.ts', 'full-autonomy-tools.ts', 'quantum-autonomous-tools.ts'],
  'memory_*':        ['memory.ts', 'persistent-memory.ts'],
  'advanced_*':      ['advanced-tools.ts', 'advanced-capabilities.ts'],
  'self-repair':     ['self-repair.ts', 'self-fix-tools.ts', 'security-self-healing.ts'],
  'enhanced_*':      ['enhanced-tools.ts'],
  'max_*':           ['max-improvements.ts'],
  'ceo_*':           ['ceo-presenter.ts'],
  'top10_*':         ['top10-real-tools.ts'],
}

for (const [group, files] of Object.entries(groups)) {
  const existing = files.filter(f => existsSync(join(libDir, f)))
  if (existing.length > 1) {
    console.log(`  [${group}] ${existing.length} files:`)
    for (const f of existing) {
      const stat = statSync(join(libDir, f))
      const size = (stat.size / 1024).toFixed(1)
      console.log(`    - ${f}  (${size}KB)`)
    }
  }
}

console.log('\n═══════════════════════════════════════════════════════════════════')
console.log('AUDIT 5: Fake / mock / stub tool functions')
console.log('═══════════════════════════════════════════════════════════════════')

// Search for tools that return hardcoded strings / mocks
const fakePatterns = [
  /return\s*\{[^}]*status:\s*['"]mock['"]/i,
  /return\s*\{[^}]*status:\s*['"]fake['"]/i,
  /return\s*\{[^}]*status:\s*['"]stub['"]/i,
  /return\s*\{[^}]*note:\s*['"]This is a mock/i,
  /\/\/\s*MOCK/i,
  /\/\/\s*FAKE/i,
  /\/\/\s*STUB/i,
  /\/\/\s*PLACEHOLDER/i,
  /return\s*\{[^}]*result:\s*['"]\(demo\)/i,
]

let totalFake = 0
for (const f of readdirSync(libDir).filter(f => f.endsWith('.ts'))) {
  const src = readFileSync(join(libDir, f), 'utf8')
  const lines = src.split('\n')
  for (let i = 0; i < lines.length; i++) {
    for (const rx of fakePatterns) {
      if (rx.test(lines[i])) {
        console.log(`  ⚠️  ${f}:${i+1} — ${lines[i].trim().slice(0, 100)}`)
        totalFake++
        break
      }
    }
  }
}
console.log(`  Total suspected mock/stub markers: ${totalFake}`)

console.log('\n═══════════════════════════════════════════════════════════════════')
console.log('AUDIT 6: Files referenced in imports but missing')
console.log('═══════════════════════════════════════════════════════════════════')

// Scan all .ts files in src/ for imports and verify each resolves
const allTsFiles: string[] = []
function walk(dir: string) {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e)
    const st = statSync(full)
    if (st.isDirectory()) walk(full)
    else if (e.endsWith('.ts') || e.endsWith('.tsx')) allTsFiles.push(full)
  }
}
walk(ROOT)

const missing = new Map<string, string[]>()
const importRx = /from\s+['"](@\/[^'"]+|\.\/[^'"]+|\.\.\/[^'"]+)['"]/g
for (const file of allTsFiles) {
  const src = readFileSync(file, 'utf8')
  let m: RegExpExecArray | null
  while ((m = importRx.exec(src)) !== null) {
    const spec = m[1]
    // Only check relative @/ and ./ imports
    let resolved: string | null = null
    if (spec.startsWith('@/')) {
      resolved = join(ROOT, spec.slice(2))
    } else if (spec.startsWith('./') || spec.startsWith('../')) {
      const dir = file.substring(0, file.lastIndexOf('/'))
      resolved = join(dir, spec)
    } else continue

    // Try .ts, .tsx, /index.ts, /index.tsx
    const candidates = [
      resolved + '.ts',
      resolved + '.tsx',
      resolved + '/index.ts',
      resolved + '/index.tsx',
    ]
    if (!candidates.some(c => existsSync(c))) {
      const key = spec
      if (!missing.has(key)) missing.set(key, [])
      missing.get(key)!.push(file.replace(ROOT + '/', ''))
    }
  }
}

if (missing.size === 0) {
  console.log('  ✓ All imports resolve')
} else {
  console.log(`  ⚠️  ${missing.size} import paths unresolved:`)
  for (const [spec, refs] of missing.entries()) {
    console.log(`    - "${spec}" referenced by:`)
    for (const r of refs.slice(0, 3)) console.log(`        ${r}`)
    if (refs.length > 3) console.log(`        ... +${refs.length - 3} more`)
  }
}

console.log('\n═══════════════════════════════════════════════════════════════════')
console.log('AUDIT 7: Vercel deployment config')
console.log('═══════════════════════════════════════════════════════════════════')

const vJson = JSON.parse(readFileSync('/home/z/my-project/vercel.json', 'utf8'))
console.log(`  vercel.json keys: ${Object.keys(vJson).join(', ')}`)
if (vJson.ignoreBuildStep) console.log(`  ignoreBuildStep: ${vJson.ignoreBuildStep}`)
if (vJson.functions) {
  for (const [pattern, cfg] of Object.entries(vJson.functions)) {
    console.log(`  function ${pattern}: ${JSON.stringify(cfg)}`)
  }
}

const dotVercelExists = existsSync('/home/z/my-project/.vercel')
console.log(`  .vercel/ exists: ${dotVercelExists}`)
if (dotVercelExists) {
  try {
    const proj = JSON.parse(readFileSync('/home/z/my-project/.vercel/project.json', 'utf8'))
    console.log(`  Linked project: ${proj.projectName} (org: ${proj.orgId})`)
  } catch (e: any) {
    console.log(`  .vercel/project.json: ${e.message}`)
  }
}

const gitIgnore = readFileSync('/home/z/my-project/.gitignore', 'utf8')
const vercelIgnoreExists = existsSync('/home/z/my-project/.vercelignore')
console.log(`  .vercelignore exists: ${vercelIgnoreExists}`)
console.log(`  .gitignore size: ${gitIgnore.length} chars`)

console.log('\n═══════════════════════════════════════════════════════════════════')
console.log('AUDIT 8: Commented-out tools / dead code in tools.ts')
console.log('═══════════════════════════════════════════════════════════════════')

const commentedTools = toolsSrc.match(/^\s*\/\/\s*TOOL_REGISTRY\.\w+/gm) || []
console.log(`  Commented-out TOOL_REGISTRY assignments: ${commentedTools.length}`)
if (commentedTools.length > 0) {
  for (const c of commentedTools.slice(0, 10)) {
    console.log(`    ${c.trim()}`)
  }
  if (commentedTools.length > 10) console.log(`    ... +${commentedTools.length - 10} more`)
}

// Also look for "TODO" / "FIXME" / "XXX" / "HACK" markers
const todoCount = (toolsSrc.match(/\b(TODO|FIXME|XXX|HACK)\b/g) || []).length
console.log(`  TODO/FIXME/XXX/HACK markers in tools.ts: ${todoCount}`)

console.log('\n✓ Audit complete.')
