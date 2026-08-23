import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { preRouteCeoRequest } from '../src/lib/ceo-pre-router'
import { buildCeoDecisionPlan } from '../src/lib/ceo-cognitive-kernel'
import { evaluateCeoQuality } from '../src/lib/ceo-response-quality-gate'
import { buildCeoDegradedResponse } from '../src/lib/ceo-degraded-mode'

const roots = ['src/lib', 'src/app', 'tests']
const lifecycleModuleNames = new Set([
  'src/lib/ceo-cognitive-contract.ts',
  'src/lib/ceo-pre-router.ts',
  'src/lib/ceo-cognitive-kernel.ts',
  'src/lib/ceo-execution-plan.ts',
  'src/lib/ceo-response-quality-gate.ts',
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
const ceoEntrypoints = new Set([
  'src/app/api/agent/route.ts',
  'src/app/api/mission-active/[missionId]/route.ts',
  'src/lib/ceo-presenter.ts',
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
const unexpected = discoveredModules.filter((file) => !lifecycleModuleNames.has(file) && /^src\/lib\/ceo-(cognitive|pre-router|execution-plan|response-quality-gate|degraded-mode|response-composer)/.test(file))
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
if (!lifecycle.includes('evaluateCeoQuality')) violations.push('Lifecycle bypasses the Response Quality Gate')
if (!lifecycle.includes('buildCeoDegradedResponse')) violations.push('Lifecycle has no degraded-mode branch')
if (!lifecycle.includes('composeCeoResponse')) violations.push('Degraded/normal output bypasses the Response Composer')
if (!lifecycle.includes('maxEscalations')) violations.push('Escalation loop has no explicit hard ceiling')
if (!lifecycle.includes('excludeProviders')) violations.push('Independent review has no provider independence control')
if (!lifecycle.includes('quality.evidenceState')) violations.push('Lifecycle does not propagate canonical evidence state')
if (!lifecycle.includes('await buildCeoDegradedResponse')) violations.push('Degraded recovery does not execute the internal evidence resolver')

if (!presenter.includes("const generationAuthorized = decisionKernel.decision === 'PROCEED'")) violations.push('CEO presenter does not enforce PROCEED as the generation boundary')
if (!presenter.includes("if (!generationAuthorized)")) violations.push('CEO HOLD/REJECT path does not short-circuit LLM generation')

if (!tsconfig.includes('"@/lib/agent": ["./src/lib/agent-canonical-bridge"]')) violations.push('tsconfig must alias @/lib/agent to the canonical cognitive bridge')
if (!orchestrator.includes("from '@/lib/agent'")) violations.push('Orchestrator lost its canonical bridge compatibility import')

// The repository contains tool/subagent implementations that intentionally use
// the Tool Runtime as a peer to the CEO Provider Runtime. They are not CEO
// entry-point bypasses. The audit therefore enforces the strict lifecycle only
// at authoritative CEO entry points and lifecycle modules, while separately
// checking that those entry points do not call legacy or provider-specific SDKs.
const authoritativeCeoFiles = files.filter((file) => ceoEntrypoints.has(file) || lifecycleModuleNames.has(file))
for (const file of authoritativeCeoFiles) {
  if (file === 'src/lib/agent.ts') continue
  const source = read(file)
  if (/callLlmWithRetry\s*\(/.test(source) && file !== 'src/lib/agent-canonical-bridge.ts') {
    violations.push(`CEO lifecycle bypass: callLlmWithRetry() in ${file}`)
  }
  if (/callFallbackLlm\s*\(/.test(source)) violations.push(`CEO lifecycle bypass: callFallbackLlm() in ${file}`)
  if (/from ['"].\/agent['"]/.test(source)) violations.push(`Legacy agent relative import in authoritative CEO file: ${file}`)
  if (/\brunCanonicalLlm\s*\(/.test(source) && file !== 'src/app/api/system/diagnose-llm/route.ts') {
    violations.push(`Direct canonical LLM call in authoritative CEO boundary: ${file}`)
  }
  if (/\.chat\.completions\.create\s*\(/.test(source)) {
    violations.push(`Direct provider chat SDK call in authoritative CEO boundary: ${file}`)
  }
}

const healthProbe = read('src/app/api/system/diagnose-llm/route.ts')
if (!healthProbe.includes('runCanonicalLlm')) violations.push('Canonical health probe lost its explicit runtime probe contract')

const legacyAgent = read('src/lib/agent.ts')
if (!legacyAgent.includes('export async function callLlmWithRetry')) violations.push('Expected legacy agent compatibility export is missing; migrate consumers before deleting the module')

// Behavioral invariants: execute the real planner/gate logic, not merely source-text checks.
const ambiguousMessages = [
  'Continue this.',
  'What about the other one instead?',
  'Also, can you check that again?',
]
for (const content of ambiguousMessages) {
  const preRoute = preRouteCeoRequest([{ role: 'user', content }])
  const plan = buildCeoDecisionPlan({ messages: [{ role: 'user', content }], preRoute })
  if (preRoute.route !== 'ambiguous') violations.push(`Behavioral invariant failed: expected ambiguous pre-route for ${JSON.stringify(content)}`)
  if (!['full', 'critical'].includes(plan.path) || plan.reasoningStrategy === 'direct' || plan.maxEscalations < 1) {
    violations.push(`Behavioral invariant failed: ambiguous request did not enforce a full cognitive floor for ${JSON.stringify(content)}`)
  }
}

const weakQuality = evaluateCeoQuality({
  objective: 'Compare the financial risks and recommended next actions for the two options.',
  content: 'This generic response contains unrelated prose. '.repeat(15),
  path: 'full',
  externalExecutionSucceeded: true,
})
if (weakQuality.decision === 'PASS') violations.push('Behavioral invariant failed: weak objective coverage was accepted by the Response Quality Gate')

const unsupportedLiveClaim = evaluateCeoQuality({
  objective: 'Give me the latest status.',
  content: 'The latest live verified status is complete and confirmed.',
  path: 'full',
  externalExecutionSucceeded: true,
  evidenceProvided: false,
})
if (unsupportedLiveClaim.checks.evidenceDiscipline) violations.push('Behavioral invariant failed: unsupported live/verified claim passed evidence discipline')

const degradedWithMemory = await buildCeoDegradedResponse({
  objective: 'What should Agent007 do about mission-42?',
  missionId: 'mission-42',
  reason: 'All providers unavailable in controlled audit.',
  recall: async () => [{ key: 'mission-42-priority', value: 'Preserve verified mission evidence before irreversible actions.', category: 'mission', createdAt: Date.now(), score: 90, timesRecalled: 0 }],
})
if (degradedWithMemory.evidenceState !== 'MEMORY_ONLY' || !degradedWithMemory.content.includes('Preserve verified mission evidence')) {
  violations.push('Behavioral invariant failed: degraded mode did not recover internal evidence')
}

if (violations.length) {
  console.error('CEO cognitive lifecycle audit FAILED')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exit(1)
}
console.log(`CEO cognitive lifecycle audit PASSED: ${lifecycleModuleNames.size} canonical lifecycle modules verified, plus behavioral planner/quality/degraded invariants across ${files.length} TypeScript files`)
