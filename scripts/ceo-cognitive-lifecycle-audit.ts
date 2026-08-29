import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { preRouteCeoRequest } from '../src/lib/ceo-pre-router'
import { buildCeoDecisionPlan } from '../src/lib/ceo-cognitive-kernel'
import { evaluateCeoQuality } from '../src/lib/ceo-response-quality-gate'
import { buildCeoDegradedResponse } from '../src/lib/ceo-degraded-mode'
import { classifyCeoSelfReflection } from '../src/lib/ceo-self-reflection'

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
  'src/lib/ceo-self-reflection.ts',
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
if (missing.length) violations.push(`Missing canonical CEO lifecycle module(s): ${missing.join(', ')}`)

const read = (file: string) => readFileSync(file, 'utf8')
const bridge = read('src/lib/agent-canonical-bridge.ts')
const presenter = read('src/lib/ceo-presenter.ts')
const lifecycle = read('src/lib/ceo-cognitive-lifecycle.ts')
const adaptive = read('src/lib/adaptive-execution.ts')
const preRouterSource = read('src/lib/ceo-pre-router.ts')
const degradedSource = read('src/lib/ceo-degraded-mode.ts')
const contractSource = read('src/lib/ceo-cognitive-contract.ts')

if (!bridge.includes("from './ceo-cognitive-lifecycle'")) violations.push('CEO compatibility bridge does not enter the cognitive lifecycle')
if (!presenter.includes("from './ceo-cognitive-lifecycle'")) violations.push('CEO presenter does not enter the cognitive lifecycle')
if (!lifecycle.includes("from './ceo-pre-router'")) violations.push('Lifecycle bypasses the deterministic pre-router')
if (!lifecycle.includes('buildCeoDecisionPlan')) violations.push('Lifecycle bypasses the Reasoning Planner')
if (!lifecycle.includes('buildCeoExecutionPlan')) violations.push('Lifecycle bypasses execution-plan materialization')
if (!lifecycle.includes('evaluateCeoQuality')) violations.push('Lifecycle bypasses the Response Quality Gate')
if (!lifecycle.includes('buildCeoDegradedResponse')) violations.push('Lifecycle has no degraded-mode branch')
if (!lifecycle.includes('composeCeoResponse')) violations.push('Lifecycle bypasses the Response Composer')
if (!lifecycle.includes('maxEscalations')) violations.push('Escalation loop has no explicit hard ceiling')
if (!lifecycle.includes('excludeProviders')) violations.push('Independent review has no provider-independence control')
if (!lifecycle.includes('quality.evidenceState')) violations.push('Lifecycle does not propagate canonical evidence state')
if (!lifecycle.includes('await buildCeoDegradedResponse')) violations.push('Degraded recovery does not execute the internal evidence resolver')
if (!lifecycle.includes("decisionPlan.executionContract.intent === 'self_assessment' ? 'reasoning'")) violations.push('Self-assessment recovery does not consume the canonical reasoning task contract')
if (!lifecycle.includes('intent: decisionPlan.executionContract.intent')) violations.push('Degraded recovery does not receive the already-decided semantic intent')

if (!adaptive.includes("from './ceo-self-reflection'")) violations.push('Adaptive execution does not depend on the canonical self-reflection classifier')
if (!adaptive.includes('if (selfReflection.isSelfReflective)')) violations.push('Adaptive execution does not protect self-reflection from deep-work escalation')
if (!preRouterSource.includes("from './ceo-self-reflection'")) violations.push('CEO pre-router does not depend on the canonical self-reflection classifier')
if (/SELF_ASSESSMENT_FOCUS_RE|SELF_REFERENCE_RE\s*=/.test(preRouterSource)) violations.push('Pre-router contains duplicated self-reflection regex logic')
if (/function isSelfAssessment\s*\(/.test(degradedSource)) violations.push('Degraded mode contains a duplicated self-assessment classifier')
if (!degradedSource.includes('input.intent === \'self_assessment\'')) violations.push('Degraded mode does not branch from the canonical intent')
if (!contractSource.includes("intent: CeoIntent")) violations.push('Execution contract no longer carries canonical intent')

const authoritativeCeoFiles = files.filter((file) => ceoEntrypoints.has(file))
for (const file of authoritativeCeoFiles) {
  const source = read(file)
  if (/callLlmWithRetry\s*\(/.test(source)) violations.push(`CEO lifecycle bypass: callLlmWithRetry() in ${file}`)
  if (/callFallbackLlm\s*\(/.test(source)) violations.push(`CEO lifecycle bypass: callFallbackLlm() in ${file}`)
  if (/from ['\"]\.\/agent['\"]/.test(source)) violations.push(`Legacy agent relative import in authoritative CEO file: ${file}`)
  if (/\brunCanonicalLlm\s*\(/.test(source)) violations.push(`Direct canonical LLM call in CEO entry point: ${file}`)
  if (/\.chat\.completions\.create\s*\(/.test(source)) violations.push(`Direct provider chat SDK call in CEO entry point: ${file}`)
}

const exactSelfAssessment = 'Hows it going? make a self-analysis and tell me if you are ready to mange businesses?'
const casualCheckin = 'How are you doing?'
const performanceReflection = 'Are you improving?'
const readinessAssessment = 'Are you ready to manage businesses?'
const capabilityAssessment = 'What are your weaknesses?'

const cases = [
  [exactSelfAssessment, 'readiness_assessment'],
  [casualCheckin, 'casual_checkin'],
  [performanceReflection, 'performance_reflection'],
  [readinessAssessment, 'readiness_assessment'],
  [capabilityAssessment, 'capability_assessment'],
] as const
for (const [text, expectedKind] of cases) {
  const classification = classifyCeoSelfReflection(text)
  if (!classification.isSelfReflective || classification.kind !== expectedKind) {
    violations.push(`Self-reflection classifier failed for ${JSON.stringify(text)}: expected ${expectedKind}`)
  }

  const decision = preRouteCeoRequest([{ role: 'user', content: text }])
  if (decision.executionContract.intent !== 'self_assessment') violations.push(`Pre-router did not preserve self_assessment for ${JSON.stringify(text)}`)
  if (decision.route !== 'fast') violations.push(`Self-assessment did not remain on fast lane for ${JSON.stringify(text)}`)
  if (decision.executionContract.latencyBudgetMs !== 30000) violations.push(`Self-assessment budget changed for ${JSON.stringify(text)}`)
}

const negativeOperational = [
  'Deploy the approved release to production.',
  'Research the latest competitors in the AI executive software market.',
  'Analyze this architecture and identify the most important weaknesses.',
  'Run this business transaction for me.',
]
for (const text of negativeOperational) {
  const classification = classifyCeoSelfReflection(text)
  if (classification.isSelfReflective) violations.push(`Operational/research request incorrectly classified as self-reflection: ${JSON.stringify(text)}`)
}

const selfAssessmentPlan = buildCeoDecisionPlan({
  messages: [{ role: 'user', content: exactSelfAssessment }],
  preRoute: preRouteCeoRequest([{ role: 'user', content: exactSelfAssessment }]),
})
if (selfAssessmentPlan.maxProviderAttempts < 4) violations.push('Self-assessment provider failover budget regressed below four attempts')
if (selfAssessmentPlan.maxEscalations !== 0) violations.push('Self-assessment unexpectedly permits quality escalation')
if (selfAssessmentPlan.executionContract.orchestrationOwner !== 'ceo_lifecycle') violations.push('Self-assessment lost CEO lifecycle ownership')

const fallback = await buildCeoDegradedResponse({
  objective: exactSelfAssessment,
  intent: 'self_assessment',
  reason: 'Controlled self-assessment fallback test.',
  recall: async () => [],
})
if (fallback.evidenceState !== 'PARTIAL_UNCONFIRMED' || !fallback.content.includes('ready to operate as a governed business-management system')) {
  violations.push('Self-assessment fallback did not return the truthful internal-state response')
}

const missionFallback = await buildCeoDegradedResponse({
  objective: 'What should Agent007 do about mission-42?',
  intent: 'mission_action',
  reason: 'Controlled mission degraded test.',
  recall: async () => [],
})
if (missionFallback.evidenceState === 'PARTIAL_UNCONFIRMED') violations.push('Non-self-assessment mission request incorrectly received self-assessment fallback')

const ambiguousMessages = [
  'Continue this.',
  'What about the other one instead?',
  'Also, can you check that again?',
]
for (const content of ambiguousMessages) {
  const preRoute = preRouteCeoRequest([{ role: 'user', content }])
  const plan = buildCeoDecisionPlan({ messages: [{ role: 'user', content }], preRoute })
  if (preRoute.route !== 'ambiguous') violations.push(`Expected ambiguous pre-route for ${JSON.stringify(content)}`)
  if (!['full', 'critical'].includes(plan.path) || plan.reasoningStrategy === 'direct' || plan.maxEscalations < 1) {
    violations.push(`Ambiguous request lost the full cognitive floor for ${JSON.stringify(content)}`)
  }
}

const weakQuality = evaluateCeoQuality({
  objective: 'Compare the financial risks and recommended next actions for the two options.',
  content: 'This generic response contains unrelated prose. '.repeat(15),
  path: 'full',
  externalExecutionSucceeded: true,
})
if (weakQuality.decision === 'PASS') violations.push('Weak objective coverage was accepted by the Response Quality Gate')

const unsupportedLiveClaim = evaluateCeoQuality({
  objective: 'Give me the latest status.',
  content: 'The latest live verified status is complete and confirmed.',
  path: 'full',
  externalExecutionSucceeded: true,
  evidenceProvided: false,
})
if (unsupportedLiveClaim.checks.evidenceDiscipline) violations.push('Unsupported live/verified claim passed evidence discipline')

const degradedWithMemory = await buildCeoDegradedResponse({
  objective: 'What should Agent007 do about mission-42?',
  intent: 'mission_action',
  missionId: 'mission-42',
  reason: 'All providers unavailable in controlled audit.',
  recall: async () => [{ key: 'mission-42-priority', value: 'Preserve verified mission evidence before irreversible actions.', category: 'mission', createdAt: Date.now(), score: 90, timesRecalled: 0 }],
})
if (degradedWithMemory.evidenceState !== 'MEMORY_ONLY' || !degradedWithMemory.content.includes('Preserve verified mission evidence')) {
  violations.push('Degraded mode did not recover internal evidence')
}

if (violations.length) {
  console.error('CEO cognitive lifecycle audit FAILED')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exit(1)
}
console.log(`CEO cognitive lifecycle audit PASSED: ${lifecycleModuleNames.size} canonical CEO modules and behavioral invariants verified across ${files.length} TypeScript files`)
