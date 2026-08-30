#!/usr/bin/env bun
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const failures: string[] = []
const read = (path: string) => readFileSync(path, 'utf8')
const requireText = (path: string, text: string, message: string) => { if (!read(path).includes(text)) failures.push(message) }
const requiredFiles = [
  'src/lib/ceo-response-quality-gate.ts','src/lib/ceo-claim-evidence-gate.ts','src/lib/ceo-evidence-bundle.ts','src/lib/ceo-evidence-executor.ts','src/lib/ceo-evidence-trace.ts','src/lib/ceo-cognitive-lifecycle.ts','src/lib/ceo-recovery-policy.ts','tests/ceo-evidence-golden.test.ts','tests/ceo-self-reflection.test.ts','tests/ceo-cognitive-lifecycle.test.ts','.github/workflows/autonomy-ci.yml',
]
for (const path of requiredFiles) if (!existsSync(path)) failures.push(`Missing canonical Stage 5–8 file: ${path}`)

requireText('src/lib/ceo-response-quality-gate.ts','verifyClaimEvidence','Stage 5 quality gate is not wired to claim-aware evidence verification.')
requireText('src/lib/ceo-claim-evidence-gate.ts','quantitative values that do not match','Stage 5 does not reject mismatched quantitative claims.')
requireText('src/lib/ceo-claim-evidence-gate.ts','markerIds','Stage 5 lacks source-identity extraction.')
requireText('src/lib/ceo-evidence-bundle.ts','canonicalizeUrl','Evidence URLs are not canonically normalized before deduplication.')
requireText('src/lib/ceo-evidence-bundle.ts','sufficient','Evidence sufficiency is not explicit.')
requireText('src/lib/ceo-evidence-executor.ts','deriveSearchSourceType','External evidence provenance is derived from query preference rather than a single classification boundary.')
requireText('src/lib/ceo-evidence-executor.ts','return \'web\'','Unverified company search results are not fail-closed to generic web evidence.')
requireText('src/lib/ceo-evidence-executor.ts','recoverExternalEvidencePlan','Evidence recovery is not a separate execution path.')
requireText('src/lib/ceo-evidence-trace.ts','persistEvidenceTrace','Evidence Trace is not durable.')
requireText('src/lib/ceo-evidence-trace.ts','process.env.NODE_ENV !== \'test\'','Evidence Trace persistence is not isolated from deterministic tests.')
requireText('src/lib/ceo-evidence-trace.ts','events.length > 100','Evidence Trace is not bounded.')
requireText('src/app/api/agent/route.ts','evidence_recovery','Operational evidence recovery is not surfaced in the governed route.')
requireText('tests/ceo-evidence-golden.test.ts','S1-PLACEHOLDER','Golden corpus lacks invalid-source-identity coverage.')
requireText('tests/ceo-evidence-golden.test.ts','250 million dollars','Golden corpus lacks quantitative mismatch coverage.')
requireText('.github/workflows/autonomy-ci.yml','CEO external evidence golden corpus','Stage 8 golden corpus is not mandatory in CI.')
requireText('.github/workflows/autonomy-ci.yml','Assert exact SHA and generate certification manifest','CI certification lacks exact-SHA verification.')
requireText('.github/workflows/production-release-watchdog.yml','DEPLOY_AGENT007_MAIN','Deployment authorization boundary is missing.')

const qualityGate = read('src/lib/ceo-response-quality-gate.ts')
if (/const LIVE_ASSERTION_RE = [^\n]*latest/i.test(qualityGate)) failures.push('"latest" incorrectly promotes an answer into live-system scope.')
const tracked = execFileSync('git',['ls-files'],{encoding:'utf8'}).split('\n').filter(Boolean)
const duplicates = tracked.filter((path) => /(^|\/)(ceo-(?:claim-evidence-gate|evidence-bundle|evidence-executor|evidence-trace))\.(?:bak|old|orig|copy)$/i.test(path))
if (duplicates.length) failures.push(`Duplicate/backup Stage 5–8 files detected: ${duplicates.join(', ')}`)

if (failures.length) { console.error('Recommendations 5–8 deep audit FAILED:'); for (const failure of failures) console.error(`- ${failure}`); process.exit(1) }
console.log('Recommendations 5–8 deep audit PASSED: claim-aware verification, freshness, provenance, sufficiency, evidence recovery, durable trace, golden corpus, CI certification, and canonical file-path integrity are coherent.')
