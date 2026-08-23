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
  'src/lib/orchestrator.ts',
  'src/app/api/agent/route.ts',
  'src/app/api/mission-active/[missionId]/route.ts',
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
const tsconfig = read('tsconfig.json')
const orchestrator = read('src/lib/orchestrator.ts')

if (!bridge.includes("from './ceo-cognitive-lifecycle'")) violations.push('CEO compatibility bridge does not enter the cognitive lifecycle')
if (!presenter.includes("from './ceo-cognitive-lifecycle'")) violations.push('CEO presenter does not enter the cognitive lifecycle')
if (!lifecycle.includes("from './ceo-pre-router'")) violations.push('Lifecycle bypasses the deterministic pre-router')
if (!lifecycle.includes('buildCeoDecisionPlan')) violations.push('Lifecycle bypasses the Reasoning Planner')
if (!lifecycle.includes('buildCeoExecutionPlan')) violations.push('Lifecycle bypasses execution-plan materialization')
if (!lifecycle.includes('evaluateCeoQuality')) violations.push('Lifecycle bypasses the Quality Gate')
if (!lifecycle.includes('buildCeoDegradedResponse')) violations.push('Lifecycle has no degraded-mode branch')
if (!lifecycle.includes('composeCeoResponse')) violations.push('Degraded/normal output bypasses the Response Composer')
if (!lifecycle.includes('maxEscalations')) violations.push('Escalation loop has no explicit hard ceiling')
if (!lifecycle.includes('excludeProviders')) violations.push('Independent review has no provider independence control')
if (!lifecycle.includes('quality.evidenceState')) violations.push('Lifecycle does not propagate canonical evidence state')

if (!presenter.includes("const generationAuthorized = decisionKernel.decision === 'PROCEED'")) violations.push('CEO presenter does not enforce PROCEED as the generation boundary')
if (!presenter.includes("if (!generationAuthorized)")) violations.push('CEO HOLD/REJECT path does not short-circuit LLM generation')

// `@/lib/agent` is an intentional compatibility alias to the canonical bridge.
// This keeps the large orchestrator/tool runtime compatible without retaining
// the legacy LLM transport at the module boundary.
if (!tsconfig.includes('"@/lib/agent": ["./src/lib/agent-canonical-bridge"]')) violations.push('tsconfig must alias @/lib/agent to the canonical cognitive bridge')
if (!orchestrator.includes("from '@/lib/agent'")) violations.push('Orchestrator lost its canonical bridge compatibility import')

const productionFiles = files.filter((file) => file.startsWith('src/') && !file.endsWith('.test.ts'))
for (const file of productionFiles) {
  if (approvedRuntimeFiles.has(file) || file === 'src/lib/agent.ts') continue
  const source = read(file)
  if (/callLlmWithRetry\s*\(/.test(source)) violations.push(`Legacy LLM execution bypass: callLlmWithRetry() in ${file}`)
  if (/callFallbackLlm\s*\(/.test(source)) violations.push(`Legacy LLM fallback bypass: callFallbackLlm() in ${file}`)
  if (/from ['"].\/agent['"]/.test(source)) violations.push(`Legacy agent relative import outside approved compatibility boundary: ${file}`)
  if (/\brunCanonicalLlm\s*\(/.test(source)) violations.push(`Direct canonical LLM call outside approved runtime boundary: ${file}`)
  if (/\.chat\.completions\.create\s*\(/.test(source)) violations.push(`Direct provider chat SDK call outside approved adapter/runtime boundary: ${file}`)
}

const healthProbe = read('src/app/api/system/diagnose-llm/route.ts')
if (!healthProbe.includes('runCanonicalLlm')) violations.push('Canonical health probe lost its explicit runtime probe contract')

// The old agent.ts implementation is retained only as an internal compatibility
// provider/helper surface. It has no approved direct production caller; the alias
// above resolves runtime imports to agent-canonical-bridge instead.
const legacyAgent = read('src/lib/agent.ts')
if (!legacyAgent.includes('export async function callLlmWithRetry')) violations.push('Expected legacy agent compatibility export is missing; migrate consumers before deleting the module')

if (violations.length) {
  console.error('CEO cognitive lifecycle audit FAILED')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exit(1)
}
console.log(`CEO cognitive lifecycle audit PASSED: ${lifecycleModuleNames.size} canonical lifecycle modules verified across ${files.length} TypeScript files, including application and orchestrator boundaries`)
