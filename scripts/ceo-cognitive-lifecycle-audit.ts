import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const roots = ['src/lib', 'src/app', 'tests']
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
const approvedRuntimeFiles = new Set([
  ...lifecycleModuleNames,
  'src/lib/agent-canonical-bridge.ts',
  'src/lib/ceo-presenter.ts',
  'src/lib/canonical-llm-router.ts',
  'src/lib/provider-runtime-v2.ts',
  'src/app/api/system/diagnose-llm/route.ts',
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

const read = (file: string) => readFileSync(file, 'utf8')
const bridge = read('src/lib/agent-canonical-bridge.ts')
const presenter = read('src/lib/ceo-presenter.ts')
const lifecycle = read('src/lib/ceo-cognitive-lifecycle.ts')

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
if (!lifecycle.includes("quality.evidenceState")) violations.push('Lifecycle does not propagate canonical evidence state')

// Mission governance must be an actual generation boundary.
if (!presenter.includes("const generationAuthorized = decisionKernel.decision === 'PROCEED'")) violations.push('CEO presenter does not enforce PROCEED as the generation boundary')
if (!presenter.includes("if (!generationAuthorized)")) violations.push('CEO HOLD/REJECT path does not short-circuit LLM generation')

// The legacy agent.ts remains a compatibility module, but it must not be a
// runtime execution path. Scan the application and library graph for callers.
for (const file of files) {
  if (approvedRuntimeFiles.has(file) || file === 'src/lib/agent.ts') continue
  const source = read(file)
  if (/callLlmWithRetry\s*\(/.test(source)) violations.push(`Legacy LLM execution bypass: callLlmWithRetry() in ${file}`)
  if (/callFallbackLlm\s*\(/.test(source)) violations.push(`Legacy LLM fallback bypass: callFallbackLlm() in ${file}`)
  if (/from ['"]@\/lib\/agent['"]/.test(source) || /from ['"].\/agent['"]/.test(source)) violations.push(`Legacy agent module imported outside approved compatibility boundary: ${file}`)
}

// Direct canonical runtime calls are allowed only in the canonical router,
// lifecycle, executive presenter, compatibility bridge, provider runtime, and
// the explicit system health probe. This prevents new application routes from
// silently bypassing planning/quality governance.
for (const file of files.filter((file) => file.startsWith('src/') && file.endsWith('.ts'))) {
  if (approvedRuntimeFiles.has(file) || file === 'src/lib/agent.ts') continue
  const source = read(file)
  if (/\brunCanonicalLlm\s*\(/.test(source)) violations.push(`Direct canonical LLM call outside approved runtime boundary: ${file}`)
  if (/\.chat\.completions\.create\s*\(/.test(source)) violations.push(`Direct provider chat SDK call outside approved adapter/runtime boundary: ${file}`)
}

// The old agent.ts implementation is retained only as a deprecated compatibility
// surface until all consumers are migrated. The audit makes that debt explicit:
// a compatibility export is not permitted to become an application caller.
const legacyAgent = read('src/lib/agent.ts')
if (!legacyAgent.includes('export async function callLlmWithRetry')) violations.push('Expected legacy agent compatibility export is missing; migrate consumers before deleting the module')

if (violations.length) {
  console.error('CEO cognitive lifecycle audit FAILED')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exit(1)
}
console.log(`CEO cognitive lifecycle audit PASSED: ${lifecycleModuleNames.size} canonical lifecycle modules verified across ${files.length} TypeScript files, including application entry points`)
