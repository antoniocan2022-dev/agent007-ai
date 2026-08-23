import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const roots = ['src/lib', 'tests']
const lifecycleModuleNames = new Set([
  'src/lib/ceo-cognitive-contract.ts',
  'src/lib/ceo-pre-router.ts',
  'src/lib/ceo-cognitive-kernel.ts',
  'src/lib/ceo-execution-plan.ts',
  'src/lib/ceo-quality-gate.ts',
  'src/lib/ceo-degraded-mode.ts',
  'src/lib/ceo-response-composer.ts',
  'src/lib/ceo-cognitive-lifecycle.ts',
])
const allowedRuntimeFiles = new Set([
  ...lifecycleModuleNames,
  'src/lib/agent-canonical-bridge.ts',
  'src/lib/ceo-presenter.ts',
  'src/lib/canonical-llm-router.ts',
  'src/lib/provider-runtime-v2.ts',
])
const files: string[] = []
for (const root of roots) {
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      const stat = statSync(path)
      if (stat.isDirectory()) walk(path)
      else if (/\.(ts|tsx)$/.test(entry)) files.push(path.replaceAll('\\', '/'))
    }
  }
  walk(root)
}

const violations: string[] = []
const discoveredModules = files.filter((file) => file.startsWith('src/lib/ceo-') && !file.endsWith('.test.ts'))
const missing = [...lifecycleModuleNames].filter((file) => !discoveredModules.includes(file))
const unexpected = discoveredModules.filter((file) => !lifecycleModuleNames.has(file) && /^src\/lib\/ceo-(cognitive|pre-router|execution-plan|quality-gate|degraded-mode|response-composer)/.test(file))
if (missing.length) violations.push(`Missing canonical CEO lifecycle module(s): ${missing.join(', ')}`)
if (unexpected.length) violations.push(`Unexpected duplicate lifecycle module(s): ${unexpected.join(', ')}`)

const bridge = readFileSync('src/lib/agent-canonical-bridge.ts', 'utf8')
const presenter = readFileSync('src/lib/ceo-presenter.ts', 'utf8')
const lifecycle = readFileSync('src/lib/ceo-cognitive-lifecycle.ts', 'utf8')

if (!bridge.includes("from './ceo-cognitive-lifecycle'")) violations.push('CEO compatibility bridge does not enter the cognitive lifecycle')
if (!presenter.includes("from './ceo-cognitive-lifecycle'")) violations.push('CEO presenter does not enter the cognitive lifecycle')
if (!lifecycle.includes("from './ceo-pre-router'")) violations.push('Lifecycle bypasses the deterministic pre-router')
if (!lifecycle.includes('buildCeoDecisionPlan')) violations.push('Lifecycle bypasses the Decision Kernel')
if (!lifecycle.includes('buildCeoExecutionPlan')) violations.push('Lifecycle bypasses execution-plan materialization')
if (!lifecycle.includes('evaluateCeoQuality')) violations.push('Lifecycle bypasses the Quality Gate')
if (!lifecycle.includes('buildCeoDegradedResponse')) violations.push('Lifecycle has no degraded-mode branch')
if (!lifecycle.includes('composeCeoResponse')) violations.push('Degraded/normal output bypasses the Response Composer')
if (!lifecycle.includes('maxEscalations')) violations.push('Escalation loop has no explicit hard ceiling')
if (!lifecycle.includes('excludeProviders')) violations.push('Independent review has no provider independence control')

for (const file of ['src/lib/agent-canonical-bridge.ts', 'src/lib/ceo-presenter.ts']) {
  const source = readFileSync(file, 'utf8')
  if (!source.includes("from './ceo-cognitive-lifecycle'")) violations.push(`CEO entry boundary bypass detected: ${file}`)
  if (source.includes("from './canonical-llm-router'") && file === 'src/lib/agent-canonical-bridge.ts') violations.push('Legacy CEO bridge still imports canonical-llm-router directly')
}

for (const file of files.filter((file) => file.startsWith('src/lib/') && file.endsWith('.ts'))) {
  if (allowedRuntimeFiles.has(file)) continue
  const source = readFileSync(file, 'utf8')
  if (/runCanonicalLlm\s*\(/.test(source)) violations.push(`Direct canonical LLM call outside approved runtime/lifecycle boundary: ${file}`)
}

if (violations.length) {
  console.error('CEO cognitive lifecycle audit FAILED')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exit(1)
}
console.log(`CEO cognitive lifecycle audit PASSED: ${lifecycleModuleNames.size} canonical lifecycle modules verified across ${files.length} TypeScript files`)
