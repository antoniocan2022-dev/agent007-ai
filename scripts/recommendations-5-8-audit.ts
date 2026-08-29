#!/usr/bin/env bun
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const failures: string[] = []
const read = (path: string) => readFileSync(path, 'utf8')
const requireText = (path: string, text: string, message: string) => {
  if (!read(path).includes(text)) failures.push(message)
}

for (const path of [
  'src/lib/ceo-response-quality-gate.ts',
  'src/lib/ceo-self-reflection.ts',
  'src/lib/ceo-cognitive-lifecycle.ts',
  'tests/ceo-self-reflection.test.ts',
  'tests/ceo-cognitive-lifecycle.test.ts',
  '.github/workflows/autonomy-ci.yml',
  '.github/workflows/production-release-watchdog.yml',
  'scripts/production-verification-audit.ts',
]) {
  if (!existsSync(path)) failures.push(`Missing canonical recommendation 5–8 file: ${path}`)
}

const qualityGate = read('src/lib/ceo-response-quality-gate.ts')

// 5. Claim-aware quality gate.
requireText('src/lib/ceo-response-quality-gate.ts', "claims.includes('live_system')", 'Live claims are not checked against live evidence scope.')
requireText('src/lib/ceo-response-quality-gate.ts', "claims.includes('external_web')", 'External claims are not checked against external evidence scope.')
if (/const LIVE_ASSERTION_RE = [^\n]*latest/i.test(qualityGate)) failures.push('The live-system claim detector incorrectly treats "latest" as proof of a live runtime.')
if (!/const EXTERNAL_ASSERTION_RE = [^\n]*latest/i.test(qualityGate)) failures.push('The external-claims detector does not recognize latest external claims.')
requireText('tests/ceo-self-reflection.test.ts', 'generic evidence cannot satisfy a positive live claim without a live scope', 'Missing generic-evidence negative control.')
requireText('tests/ceo-self-reflection.test.ts', 'external claims require explicit external evidence and freshness', 'Missing external scope/freshness regression.')
requireText('tests/ceo-self-reflection.test.ts', 'mixed internal and live claims require mixed fresh evidence', 'Missing mixed-scope regression.')

// 6. Executive readiness synthesis reuses existing evidence only.
requireText('src/lib/ceo-cognitive-lifecycle.ts', 'synthesizeExecutiveReadiness', 'Lifecycle does not use the canonical executive-readiness synthesis.')
requireText('src/lib/ceo-cognitive-lifecycle.ts', 'GOVERNED EXECUTIVE READINESS BASELINE', 'Readiness synthesis is not surfaced as governed internal evidence.')
requireText('tests/ceo-self-reflection.test.ts', 'executive readiness remains conservative without operational proof', 'Missing conservative readiness regression.')
requireText('tests/ceo-self-reflection.test.ts', 'executive readiness requires sustained autonomy in addition to outcomes for Level E', 'Missing cumulative Level-E regression.')

// 7. Evidence freshness.
requireText('src/lib/ceo-response-quality-gate.ts', 'age >= 0 && age <= freshness.maxAgeMs', 'Claim evidence freshness does not reject future/stale evidence.')
requireText('src/lib/ceo-self-reflection.ts', 'now - input.observedAt >= 0 && now - input.observedAt <= input.maxEvidenceAgeMs', 'Readiness freshness does not reject future/stale evidence.')
requireText('tests/ceo-self-reflection.test.ts', 'stale and future live evidence fail', 'Missing stale/future evidence controls.')

// 8. Full regression corpus.
requireText('tests/ceo-self-reflection.test.ts', 'the exact original 5–10 minute incident stays on the bounded path', 'Original 5–10 minute incident regression is missing.')
requireText('tests/ceo-cognitive-lifecycle.test.ts', 'critical responses require supporting evidence before PASS and LIVE_VERIFIED', 'Critical evidence regression is missing.')
requireText('tests/ceo-cognitive-lifecycle.test.ts', 'critical lifecycle executes primary → independent review → synthesis on canonical providers', 'Critical stage regression is missing.')
requireText('.github/workflows/autonomy-ci.yml', 'CEO claim-aware, readiness and incident regression corpus', 'Autonomy CI does not execute the full claim-aware/readiness corpus.')

// Exact-SHA certification and manual Vercel authorization boundary.
requireText('.github/workflows/autonomy-ci.yml', 'Assert exact SHA and generate certification manifest', 'CI certification lacks exact-SHA verification.')
requireText('.github/workflows/autonomy-ci.yml', 'vercelDeploymentPerformed": false', 'Certification manifest does not record Vercel as not deployed.')
requireText('.github/workflows/autonomy-ci.yml', 'MANUAL_AUTHORIZATION_REQUIRED', 'Certification does not preserve manual deployment authorization.')
requireText('scripts/production-verification-audit.ts', 'Wait for exact-SHA CI gates', 'Production readiness audit lacks exact-SHA CI gating.')
requireText('.github/workflows/production-release-watchdog.yml', 'DEPLOY_AGENT007_MAIN', 'Production release workflow lacks explicit authorization control.')

// Canonical implementation-path integrity.
const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean)
const duplicatePatterns = [
  /(^|\/)ceo-response-quality-gate\.(?:bak|old|orig|copy)$/i,
  /(^|\/)ceo-self-reflection\.(?:bak|old|orig|copy)$/i,
  /(^|\/)ceo-cognitive-lifecycle\.(?:bak|old|orig|copy)$/i,
]
const duplicates = tracked.filter((path) => duplicatePatterns.some((pattern) => pattern.test(path)))
if (duplicates.length) failures.push(`Duplicate/backup CEO recommendation files detected: ${duplicates.join(', ')}`)

if (failures.length) {
  console.error('Recommendations 5–8 deep audit FAILED:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Recommendations 5–8 deep audit PASSED: claim scope, freshness, executive readiness, regression corpus, exact-SHA certification, deployment authorization, and canonical file-path integrity are coherent.')
