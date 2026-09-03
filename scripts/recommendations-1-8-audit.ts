#!/usr/bin/env bun
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const failures: string[] = []
const read = (path: string) => readFileSync(path, 'utf8')
const has = (path: string, token: string, message: string) => { if (!read(path).includes(token)) failures.push(message) }

const canonicalFiles = [
  'src/lib/agent-canonical-bridge.ts','src/lib/ceo-cognitive-contract.ts','src/lib/ceo-cognitive-kernel.ts','src/lib/ceo-execution-plan.ts','src/lib/ceo-cognitive-lifecycle.ts','src/lib/ceo-response-quality-gate.ts','src/lib/ceo-claim-evidence-gate.ts','src/lib/ceo-evidence-bundle.ts','src/lib/ceo-evidence-executor.ts','src/lib/ceo-evidence-trace.ts','src/lib/ceo-recovery-policy.ts','src/lib/ceo-self-reflection.ts','src/lib/ceo-presenter.ts','src/lib/proof-ledger.ts','tests/canonical-runtime-integrity.test.ts','tests/adaptive-execution.test.ts','tests/ceo-decision-kernel.test.ts','tests/artifact-evidence.test.ts','tests/verification-officer.test.ts','tests/verification-gate.test.ts','tests/ceo-self-reflection.test.ts','tests/ceo-cognitive-lifecycle.test.ts','tests/ceo-real-request-corpus.test.ts','tests/ceo-evidence-golden.test.ts','scripts/recommendations-5-8-audit.ts',
]
for (const file of canonicalFiles) if (!existsSync(file)) failures.push(`Missing canonical Stage 1–8 file: ${file}`)

// Stage 1 — canonical runtime ownership.
has('src/lib/agent-canonical-bridge.ts','runCeoCognitiveLifecycle','Stage 1 is not routed through the canonical CEO lifecycle.')
has('src/lib/agent-canonical-bridge.ts','getOrchestrationOwner','Stage 1 lacks canonical orchestration ownership resolution.')
has('tests/canonical-runtime-integrity.test.ts','does not introduce additional direct legacy LLM transport calls','Stage 1 legacy-transport regression missing.')

// Stage 2 — adaptive execution contract.
has('src/lib/ceo-cognitive-contract.ts',"export type PreRoute = 'fast' | 'full' | 'ambiguous'",'Stage 2 route taxonomy missing.')
has('tests/adaptive-execution.test.ts','parallel execution is blocked for the fast lane before any provider call','Stage 2 fast-lane isolation regression missing.')
has('tests/ceo-cognitive-lifecycle.test.ts','self-assessment stays CEO-owned even when generic analysis keywords are present','Stage 2 CEO ownership regression missing.')

// Stage 3 — Decision Kernel + governed escalation.
has('src/lib/ceo-cognitive-kernel.ts','buildCeoDecisionPlan','Stage 3 Decision Kernel missing.')
has('tests/ceo-decision-kernel.test.ts','proceeds only when all mandatory gates pass','Stage 3 mandatory-gate regression missing.')
has('tests/ceo-cognitive-lifecycle.test.ts','critical lifecycle executes primary → independent review → synthesis on canonical providers','Stage 3 critical multi-stage integration missing.')

// Stage 4 — proof/artifact/verification boundary.
has('src/lib/proof-ledger.ts','verifyEvidenceLedger','Stage 4 proof-ledger verification missing.')
has('tests/artifact-evidence.test.ts','rejects a URL that is syntactically valid but unreachable','Stage 4 artifact reachability regression missing.')
has('tests/verification-officer.test.ts','does not allow a producer to manufacture critical independence','Stage 4 independent-verification boundary missing.')
has('tests/verification-gate.test.ts','blocks challenged evidence instead of allowing a producer result to pass','Stage 4 challenged-evidence hard gate missing.')

// Stage 5 — claim-aware evidence.
has('src/lib/ceo-response-quality-gate.ts','verifyClaimEvidence','Stage 5 quality gate bypasses claim-aware verification.')
has('src/lib/ceo-claim-evidence-gate.ts','quantitative values that do not match','Stage 5 quantitative claim verification missing.')
has('src/lib/ceo-claim-evidence-gate.ts','markerIds','Stage 5 source-identity verification missing.')
has('tests/ceo-evidence-golden.test.ts','S1-PLACEHOLDER','Stage 5 invalid-source-marker regression missing.')
has('tests/ceo-evidence-golden.test.ts','250 million dollars','Stage 5 quantitative mismatch regression missing.')

// Stage 6 — operational lifecycle integration.
has('src/app/api/agent/route.ts','runCeoCognitiveLifecycle','Stage 6 operational execution is not fed back into the CEO lifecycle.')
has('src/app/api/agent/route.ts','const operationalEvidence','Stage 6 operational evidence envelope missing.')
has('src/app/api/agent/route.ts','db.message.update','Stage 6 synthesis does not update canonical persisted history.')

// Stage 7 — recovery/abstention separation.
has('src/lib/ceo-evidence-executor.ts','recoverExternalEvidencePlan','Stage 7 evidence recovery path missing.')
has('src/lib/ceo-recovery-policy.ts','class RecoveryBudget','Stage 7 reasoning recovery budget missing.')
has('src/app/api/agent/route.ts','evidence_recovery','Stage 7 evidence-recovery events missing from runtime.')

// Stage 8 — durable golden corpus + Evidence Trace.
has('src/lib/ceo-evidence-trace.ts','persistEvidenceTrace','Stage 8 Evidence Trace persistence missing.')
has('src/lib/ceo-evidence-trace.ts','events.length > 100','Stage 8 Evidence Trace is not bounded.')
has('tests/ceo-evidence-golden.test.ts','golden external evidence corpus','Stage 8 golden corpus missing.')
has('.github/workflows/autonomy-ci.yml','CEO external evidence golden corpus','Stage 8 golden corpus is not mandatory in CI.')

// Exact-SHA certification and deployment boundary.
has('.github/workflows/autonomy-ci.yml','CI certification','CI lacks exact certification stage.')
has('.github/workflows/autonomy-ci.yml','Assert exact SHA and generate certification manifest','Certification does not bind to exact commit.')
has('.github/workflows/production-release-watchdog.yml','DEPLOY_AGENT007_MAIN','Deployment authorization boundary missing.')

// Cross-layer single-source + duplicate-file integrity.
const tracked = execFileSync('git',['ls-files'],{encoding:'utf8'}).split('\n').filter(Boolean)
const badBackups = tracked.filter((path) => /(^|\/)(agent-canonical-bridge|ceo-cognitive-contract|ceo-cognitive-kernel|ceo-execution-plan|ceo-cognitive-lifecycle|ceo-response-quality-gate|ceo-claim-evidence-gate|ceo-evidence-bundle|ceo-evidence-executor|ceo-evidence-trace|ceo-self-reflection)\.(?:bak|old|orig|copy)$/i.test(path))
if (badBackups.length) failures.push(`Canonical Stage 1–8 backup/duplicate files detected: ${badBackups.join(', ')}`)

const qualityGate = read('src/lib/ceo-response-quality-gate.ts')
if (/const LIVE_ASSERTION_RE = [^\n]*latest/i.test(qualityGate)) failures.push('"latest" incorrectly promotes an answer into live-system scope.')
if (!/evidenceBundle\?:\s*EvidenceBundle/.test(qualityGate)) failures.push('Quality gate lacks structured evidence-bundle input.')

const evidenceBundle = read('src/lib/ceo-evidence-bundle.ts')
if (!evidenceBundle.includes('canonicalizeUrl')) failures.push('Evidence bundle lacks canonical URL normalization.')
if (!evidenceBundle.includes('sufficient')) failures.push('Evidence bundle lacks explicit sufficiency state.')

const executor = read('src/lib/ceo-evidence-executor.ts')
if (!executor.includes("return 'web'")) failures.push('External evidence provenance is not fail-closed to generic web evidence.')

const trace = read('src/lib/ceo-evidence-trace.ts')
if (!trace.includes("category: 'evidence_trace'")) failures.push('Evidence Trace is not stored in the canonical durable memory store.')

if (failures.length) {
  console.error('Full Recommendations 1–8 audit FAILED:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}
console.log(`Full Recommendations 1–8 audit PASSED: canonical runtime, adaptive routing, Decision Kernel, proof/verification, claim-aware evidence, lifecycle integration, recovery/abstention, durable Evidence Trace, golden corpus, CI certification, and duplicate-file integrity are coordinated.`)
