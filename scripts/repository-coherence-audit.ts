#!/usr/bin/env bun
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'

/**
 * Repository Coherence Audit
 *
 * Complements deep-integrity-audit.ts by protecting the repository itself
 * from rapid-upgrade drift: duplicate files, missing canonical modules/tests,
 * stale architecture claims, and accidental hosting coupling.
 */

const failures: string[] = []
const record = (condition: boolean, message: string) => {
  if (!condition) failures.push(message)
}

const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .map((path) => path.trim())
  .filter(Boolean)

const trackedSet = new Set(tracked)
const read = (path: string) => readFileSync(path, 'utf8')
const isSource = (path: string) => /^(src|scripts)\//.test(path) && ['.ts', '.tsx', '.js', '.jsx'].includes(extname(path))

// 1. Required architecture contracts must exist together.
const requiredFiles = [
  'src/lib/provider-intelligence-policy.ts',
  'src/lib/provider-runtime-v2.ts',
  'src/lib/model-intelligence.ts',
  'src/lib/performance-intelligence.ts',
  'src/lib/outcome-intelligence.ts',
  'src/lib/outcome-intelligence.test.ts',
  'scripts/deep-integrity-audit.ts',
  '.github/workflows/autonomy-ci.yml',
  'prisma/schema.prisma',
]
for (const path of requiredFiles) record(trackedSet.has(path), `Required architecture file is missing: ${path}`)

// 2. Case-insensitive duplicate paths are dangerous on macOS/Windows even if
// Git accepts both names. They can silently resolve to the wrong module.
const caseGroups = new Map<string, string[]>()
for (const path of tracked) {
  const key = path.toLowerCase()
  const group = caseGroups.get(key) ?? []
  group.push(path)
  caseGroups.set(key, group)
}
for (const [key, group] of caseGroups) {
  if (group.length > 1) failures.push(`Case-insensitive duplicate paths: ${key} => ${group.join(', ')}`)
}

// 3. Exact duplicate source files create split-brain maintenance: a fix can
// land in one copy while callers still execute another.
const byHash = new Map<string, string[]>()
for (const path of tracked.filter(isSource)) {
  const hash = createHash('sha256').update(read(path)).digest('hex')
  const group = byHash.get(hash) ?? []
  group.push(path)
  byHash.set(hash, group)
}
for (const [hash, group] of byHash) {
  if (group.length > 1) {
    const productionCopies = group.filter((path) => !/\.test\.|\.spec\./.test(basename(path)))
    if (productionCopies.length > 1) failures.push(`Exact duplicate production source files (${hash.slice(0, 12)}): ${productionCopies.join(', ')}`)
  }
}

// 4. Current documentation must not reintroduce historical hard-coded
// architecture counts. README is intentionally the stable, non-counted view.
const readme = read('README.md')
record(!/\b\d+\+? tools\b/i.test(readme), 'README contains a hard-coded tool count')
record(!/\b\d+ sub-?agents?\b/i.test(readme), 'README contains a hard-coded sub-agent count')
record(!/Prisma Models \(\d+\)/i.test(readme), 'README contains a hard-coded Prisma model count')

// 5. Historical Vercel hostnames must not leak into application runtime code.
// Deployment documentation/scripts may legitimately mention Vercel; runtime
// source must resolve public URLs through the hosting-neutral boundary.
const runtimePaths = tracked.filter((path) => /^src\//.test(path))
const historicalHostFiles = runtimePaths.filter((path) => {
  try { return read(path).includes('agent007-ai.vercel.app') } catch { return false }
})
record(historicalHostFiles.length === 0, `Historical Vercel hostname leaked into application source: ${historicalHostFiles.join(', ')}`)

// 6. Intelligence layers must retain their explicit separation. Performance
// evidence may feed outcome fallback, but transport success must not be called
// a verified business outcome.
const outcome = read('src/lib/outcome-intelligence.ts')
const performance = read('src/lib/performance-intelligence.ts')
const runtime = read('src/lib/provider-runtime-v2.ts')
record(outcome.includes('verified_success') && outcome.includes('verificationPassed'), 'Outcome Intelligence lacks explicit verification semantics')
record(outcome.includes('getPerformanceSnapshot'), 'Outcome Intelligence does not have a conservative performance fallback')
record(performance.includes('recordModelPerformance'), 'Performance Intelligence recorder is missing')
record(runtime.includes('recordModelPerformance'), 'Provider runtime is not feeding observed performance evidence')

// 7. The main merge gate must execute both repository-integrity and intelligence
// contracts. This prevents future upgrades from being locally correct but
// globally inconsistent.
const workflow = read('.github/workflows/autonomy-ci.yml')
record(workflow.includes('scripts/deep-integrity-audit.ts'), 'Autonomy CI does not run the deep integrity audit')
record(workflow.includes('scripts/repository-coherence-audit.ts'), 'Autonomy CI does not run the repository coherence audit')
record(workflow.includes('src/lib/outcome-intelligence.test.ts'), 'Autonomy CI does not run Outcome Intelligence tests')
record(workflow.includes('tsc -p tsconfig.ci.json --noEmit'), 'Autonomy CI does not enforce the CI TypeScript gate')

if (failures.length) {
  console.error('Repository coherence audit FAILED:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`Repository coherence audit PASSED: ${tracked.length} tracked files checked; architecture, duplicate-path, duplicate-content, documentation, host-boundary, and CI contracts are coherent.`)
