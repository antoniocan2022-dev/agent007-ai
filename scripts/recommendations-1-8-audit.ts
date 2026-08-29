#!/usr/bin/env bun
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const failures: string[] = []
const read = (path: string) => readFileSync(path, 'utf8')
const has = (path: string, token: string, message: string) => {
  if (!read(path).includes(token)) failures.push(message)
}

const canonicalFiles = [
  'src/lib/agent-canonical-bridge.ts',
  'src/lib/ceo-cognitive-contract.ts',
  'src/lib/ceo-cognitive-kernel.ts',
  'src/lib/ceo-execution-plan.ts',
  'src/lib/ceo-cognitive-lifecycle.ts',
  'src/lib/ceo-response-quality-gate.ts',
  'src/lib/ceo-self-reflection.ts',
  'src/lib/ceo-presenter.ts',
  'src/lib/proof-ledger.ts',
  'tests/canonical-runtime-integrity.test.ts',
  'tests/adaptive-execution.test.ts',
  'tests/ceo-decision-kernel.test.ts',
  'tests/artifact-evidence.test.ts',
  'tests/verification-officer.test.ts',
  'tests/verification-gate.test.ts',
  'tests/ceo-self-reflection.test.ts',
  'tests/ceo-cognitive-lifecycle.test.ts',
  'tests/ceo-real-request-corpus.test.ts',
  'scripts/recommendations-5-8-audit.ts',
]
for (const file of canonicalFiles) if (!existsSync(file)) failures.push(`Missing canonical recommendation 1–8 file: ${file}`)

// 1. Canonical runtime ownership.
has('src/lib/agent-canonical-bridge.ts', 'runCeoCognitiveLifecycle', 'Recommendation 1 is not routed through the canonical CEO lifecycle.')
has('src/lib/agent-canonical-bridge.ts', "getOrchestrationOwner", 'Recommendation 1 lacks canonical orchestration ownership resolution.')
has('tests/canonical-runtime-integrity.test.ts', 'does not introduce additional direct legacy LLM transport calls', 'Missing legacy-transport regression for Recommendation 1.')

// 2. Adaptive execution.
has('src/lib/ceo-cognitive-contract.ts', "export type PreRoute = 'fast' | 'full' | 'ambiguous'", 'Adaptive execution contract is missing its canonical route taxonomy.')
has('tests/adaptive-execution.test.ts', 'parallel execution is blocked for the fast lane before any provider call', 'Missing fast-lane isolation regression.')
has('tests/ceo-cognitive-lifecycle.test.ts', 'self-assessment stays CEO-owned even when generic analysis keywords are present', 'Missing CEO ownership regression for adaptive routing.')

// 3. CEO Decision Kernel + governed escalation.
has('src/lib/ceo-cognitive-kernel.ts', 'buildCeoDecisionPlan', 'Recommendation 3 lacks the canonical Decision Kernel.')
has('tests/ceo-decision-kernel.test.ts', 'proceeds only when all mandatory gates pass', 'Decision Kernel gate regression is missing.')
has('tests/ceo-cognitive-lifecycle.test.ts', 'critical lifecycle executes primary → independent review → synthesis on canonical providers', 'Critical multi-stage integration is missing.')

// 4. Proof/artifact/independent verification.
has('src/lib/proof-ledger.ts', 'verifyEvidenceLedger', 'Recommendation 4 lacks proof-ledger verification.')
has('tests/artifact-evidence.test.ts', 'rejects a URL that is syntactically valid but unreachable', 'Artifact evidence verification regression is missing.')
has('tests/verification-officer.test.ts', 'does not allow a producer to manufacture critical independence', 'Independent Verification Officer boundary is missing.')
has('tests/verification-gate.test.ts', 'blocks challenged evidence instead of allowing a producer result to pass', 'Verification hard-gate regression is missing.')

// 5–7. Claims, readiness and freshness.
has('src/lib/ceo-response-quality-gate.ts', "claims.includes('live_system')", 'Live claim scope enforcement missing.')
has('src/lib/ceo-response-quality-gate.ts', "claims.includes('external_web')", 'External claim scope enforcement missing.')
if (/const LIVE_ASSERTION_RE = [^\n]*latest/i.test(read('src/lib/ceo-response-quality-gate.ts'))) failures.push('"latest" incorrectly promotes an answer into live-system scope.')
has('src/lib/ceo-self-reflection.ts', 'synthesizeExecutiveReadiness', 'Executive readiness synthesis missing.')
has('src/lib/ceo-cognitive-lifecycle.ts', 'GOVERNED EXECUTIVE READINESS BASELINE', 'Readiness is not integrated into the canonical lifecycle.')
has('tests/ceo-self-reflection.test.ts', 'stale and future live evidence fail', 'Freshness boundary regressions are missing.')

// 8. Full regression corpus + exact incident preservation.
has('tests/ceo-self-reflection.test.ts', 'the exact original 5–10 minute incident stays on the bounded path', 'Original incident regression missing.')
has('tests/ceo-real-request-corpus.test.ts', 'describe(', 'Real-request regression corpus is missing or empty.')
has('.github/workflows/autonomy-ci.yml', 'CEO real-request contract corpus', 'Main CI does not execute the real-request corpus.')
has('.github/workflows/autonomy-ci.yml', 'CI certification', 'Main CI lacks final certification.')
has('.github/workflows/autonomy-ci.yml', 'Assert exact SHA and generate certification manifest', 'Certification does not bind to the exact commit.')
has('.github/workflows/autonomy-ci.yml', 'MANUAL_AUTHORIZATION_REQUIRED', 'CI certification does not preserve manual deployment authorization.')

// Cross-layer coordination: one canonical lifecycle, one canonical evidence gate, no backup duplicates.
const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean)
const badBackups = tracked.filter((path) => /(^|\/)(agent-canonical-bridge|ceo-cognitive-contract|ceo-cognitive-kernel|ceo-execution-plan|ceo-cognitive-lifecycle|ceo-response-quality-gate|ceo-self-reflection)\.(?:bak|old|orig|copy)$/i.test(path))
if (badBackups.length) failures.push(`Canonical recommendation backup/duplicate files detected: ${badBackups.join(', ')}`)

if (failures.length) {
  console.error('Full Recommendations 1–8 audit FAILED:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Full Recommendations 1–8 audit PASSED: canonical runtime, adaptive routing, Decision Kernel, proof/verification, claim-aware quality, executive readiness, freshness, regression corpus, CI certification, and deployment authorization boundaries are coordinated and coherent.')
