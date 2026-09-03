#!/usr/bin/env bun
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { CANONICAL_CAPABILITY_LEDGER } from '../src/lib/architecture-integrity-contract'

const ROOT = process.cwd()
const failures: string[] = []
const warnings: string[] = []
const files: string[] = []
const walk = (dir: string) => { for (const entry of readdirSync(dir)) { if (entry === 'node_modules' || entry === '.next' || entry === '.git') continue; const path = join(dir, entry); if (statSync(path).isDirectory()) walk(path); else files.push(relative(ROOT, path).replaceAll('\\', '/')) } }
walk(ROOT)
const text = (path: string) => readFileSync(join(ROOT, path), 'utf8')
const sourcePaths = files.filter((path) => /\.(ts|tsx)$/.test(path))
const sourceTexts = new Map(sourcePaths.map((path) => [path, text(path)]))
const allSource = [...sourceTexts.values()].join('\n')
const required = [
  'src/lib/architecture-control-plane.ts', 'src/lib/architecture-integrity-contract.ts', 'src/lib/ceo-system-contract.ts', 'src/lib/ceo-conversation-decision-contract.ts',
  'src/lib/ceo-cognitive-kernel.ts', 'src/lib/ceo-capability-architecture.ts', 'src/lib/ceo-tool-selection.ts', 'src/lib/ceo-evidence-planner.ts',
  'src/lib/ceo-evidence-executor.ts', 'src/lib/ceo-evidence-bundle.ts', 'src/lib/ceo-response-quality-gate.ts', 'src/lib/ceo-outcome-learning.ts',
  'src/lib/ceo-behavioral-learning.ts', 'src/lib/ceo-self-reflection.ts', 'src/lib/ceo-operator-intelligence.ts', 'src/lib/evolution-engine.ts',
  'src/lib/closed-loop-improvement.ts', 'src/lib/ceo-continuous-loop.ts', 'src/lib/ceo-degraded-mode.ts', 'src/app/api/agent/route.ts',
  'src/app/api/architecture/business-outcome/route.ts', 'src/app/api/system/evolution/route.ts', 'tests/continuous-loop-integrity.test.ts',
]
for (const path of required) if (!existsSync(join(ROOT, path))) failures.push(`Missing canonical architecture file: ${path}`)
for (const [key, entry] of Object.entries(CANONICAL_CAPABILITY_LEDGER)) {
  if (!entry.canonicalOwner.trim()) failures.push(`${key}: empty canonicalOwner`)
  if (!entry.runtimeEntryPoints.length) failures.push(`${key}: no runtime entry point`)
  if (!entry.consumers.length) failures.push(`${key}: no registered consumers`)
  if (!entry.requiredContracts.length) failures.push(`${key}: no required contract`)
  if (!entry.verificationMethod.trim()) failures.push(`${key}: no verification method`)
  if (!entry.integrationProof.trim()) failures.push(`${key}: no integration proof`)
  if (entry.productionObserved && entry.lifecycleState !== 'OBSERVED' && entry.lifecycleState !== 'PROVEN') failures.push(`${key}: productionObserved=true requires OBSERVED or PROVEN lifecycle state`)
  const ownerTokens = entry.canonicalOwner.split(' + ').map((owner) => owner.replace(/^(?:src\/lib\/)?/, ''))
  for (const owner of ownerTokens) if (!allSource.includes(owner)) failures.push(`${key}: canonical owner token ${owner} not represented in repository source`)
  for (const consumer of entry.consumers) if (!allSource.includes(consumer)) failures.push(`${key}: registered consumer ${consumer} not represented in repository source`)
}
const mainWorkflow = text('.github/workflows/architecture-control-plane-verification.yml')
if (!/push:[\s\S]*?branches:\s*\[[^\]]*\bmain\b[^\]]*\]/m.test(mainWorkflow)) failures.push('Architecture Control Plane workflow does not run on main pushes')
if (!/pull_request:[\s\S]*?branches:\s*\[[^\]]*\bmain\b[^\]]*\]/m.test(mainWorkflow)) failures.push('Architecture Control Plane workflow does not gate pull requests into main')
const executor = text('src/lib/ceo-evidence-executor.ts')
const evidenceGate = text('src/lib/ceo-decision-grade-evidence.ts')
const degradedMode = text('src/lib/ceo-degraded-mode.ts')
const outcomeLearning = text('src/lib/ceo-outcome-learning.ts')
const continuousLoop = text('src/lib/ceo-continuous-loop.ts')
if (!executor.includes('assertDecisionGradeEvidence')) failures.push('Evidence executor is not wired to the decision-grade evidence gate')
if (!evidenceGate.includes("code = 'ABSTAINED_REQUIRED_EVIDENCE'")) failures.push('Decision-grade evidence gate lacks explicit abstention code')
if (!degradedMode.includes('ABSTAINED_REQUIRED_EVIDENCE')) failures.push('Degraded mode does not expose the explicit high-risk abstention state')
if (!executor.includes("capability: 'evidence_acquisition'")) failures.push('Evidence executor is missing architecture-integrity runtime ownership assertion')
if (!outcomeLearning.includes('predictedOutcome') || !outcomeLearning.includes('decisionRationale') || !outcomeLearning.includes('predictionError')) failures.push('Outcome-learning contract does not contain prediction chain fields')
if (!continuousLoop.includes('assertLoopTransition')) failures.push('Continuous loop does not enforce canonical transition contracts')
if (!continuousLoop.includes('AWAITING_APPROVAL')) failures.push('Continuous loop lacks governed approval state')
const canonicalFileNames = sourcePaths.map((path) => path.split('/').pop() ?? '').filter(Boolean)
const duplicatePairs: string[] = []
for (const path of sourcePaths) {
  const base = path.split('/').pop() ?? ''
  const match = base.match(/^(.+?)[-_](legacy|old|backup|copy|final|new|v\d+)\.(?:ts|tsx)$/i)
  if (!match) continue
  const stem = match[1]
  const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const siblingRe = new RegExp(`^${escaped}\\.(?:ts|tsx)$`, 'i')
  const siblings = canonicalFileNames.filter((candidate) => siblingRe.test(candidate))
  for (const sibling of siblings) duplicatePairs.push(`${sibling} <-> ${base}`)
}
for (const pair of [...new Set(duplicatePairs)]) warnings.push(`Potential implementation duplicate requiring classification: ${pair}`)
const result = { schemaVersion: 4, generatedAt: new Date().toISOString(), fileCount: files.length, sourceFileCount: sourcePaths.length, canonicalCapabilityCount: Object.keys(CANONICAL_CAPABILITY_LEDGER).length, canonicalCapabilityLedger: CANONICAL_CAPABILITY_LEDGER, requiredArchitectureFiles: required, findings: failures, warnings, status: failures.length ? 'FAILED' : 'PASSED' }
console.log(JSON.stringify(result, null, 2))
if (warnings.length) console.error(`Architecture baseline warnings: ${warnings.length}`)
if (failures.length) process.exit(1)
