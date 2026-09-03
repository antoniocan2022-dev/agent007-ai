#!/usr/bin/env bun
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { CANONICAL_CAPABILITY_LEDGER } from '../src/lib/architecture-integrity-contract'

const ROOT = process.cwd()
const failures: string[] = []
const files: string[] = []
const walk = (dir: string) => {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === '.git') continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) walk(path)
    else files.push(relative(ROOT, path).replaceAll('\\', '/'))
  }
}
walk(ROOT)

const text = (path: string) => readFileSync(join(ROOT, path), 'utf8')
const trackedLike = files.filter((path) => /\.(ts|tsx|yml|yaml)$/.test(path))
const sourceTexts = new Map(trackedLike.map((path) => [path, text(path)]))
const allSource = [...sourceTexts.values()].join('\n')

const required = [
  'src/lib/architecture-control-plane.ts',
  'src/lib/architecture-integrity-contract.ts',
  'src/lib/ceo-system-contract.ts',
  'src/lib/ceo-conversation-decision-contract.ts',
  'src/lib/ceo-cognitive-kernel.ts',
  'src/lib/ceo-capability-architecture.ts',
  'src/lib/ceo-tool-selection.ts',
  'src/lib/ceo-evidence-planner.ts',
  'src/lib/ceo-evidence-executor.ts',
  'src/lib/ceo-evidence-bundle.ts',
  'src/lib/ceo-response-quality-gate.ts',
  'src/lib/ceo-outcome-learning.ts',
  'src/lib/ceo-self-reflection.ts',
  'src/lib/ceo-operator-intelligence.ts',
  'src/lib/evolution-engine.ts',
  'src/lib/closed-loop-improvement.ts',
  'src/lib/ceo-degraded-mode.ts',
  'src/app/api/agent/route.ts',
]
for (const path of required) if (!existsSync(join(ROOT, path))) failures.push(`Missing canonical architecture file: ${path}`)

for (const [key, entry] of Object.entries(CANONICAL_CAPABILITY_LEDGER)) {
  if (!entry.canonicalOwner.trim()) failures.push(`${key}: empty canonicalOwner`)
  if (!entry.runtimeEntryPoints.length) failures.push(`${key}: no runtime entry point`)
  if (!entry.consumers.length) failures.push(`${key}: no registered consumers`)
  if (!entry.requiredContracts.length) failures.push(`${key}: no required contract`)
  if (!entry.verificationMethod.trim()) failures.push(`${key}: no verification method`)
  if (!allSource.includes(entry.canonicalOwner.split(' + ')[0])) failures.push(`${key}: canonical owner is not represented in repository source`)
  for (const consumer of entry.consumers) if (!allSource.includes(consumer)) failures.push(`${key}: registered consumer ${consumer} not represented in repository source`)
}

const mainWorkflow = text('.github/workflows/architecture-control-plane-verification.yml')
if (!/push:\s*\n\s*branches:\s*\[.*\bmain\b.*\]/m.test(mainWorkflow)) failures.push('Architecture Control Plane workflow does not run on main pushes')
if (!/pull_request:\s*\n\s*branches:\s*\[.*\bmain\b.*\]/m.test(mainWorkflow)) failures.push('Architecture Control Plane workflow does not gate pull requests into main')
if (!text('src/lib/ceo-evidence-executor.ts').includes('ABSTAINED_REQUIRED_EVIDENCE')) failures.push('Evidence executor is missing the fail-closed decision-grade gate')
if (!text('src/lib/ceo-decision-grade-evidence.ts').includes("failClosed: true")) failures.push('Decision-grade evidence policy is not fail-closed')
if (!text('src/lib/ceo-degraded-mode.ts').includes('ABSTAINED_REQUIRED_EVIDENCE')) failures.push('Degraded mode does not expose the explicit high-risk abstention state')

const duplicates = new Map<string, string[]>()
for (const path of trackedLike) {
  const basename = path.split('/').pop()?.replace(/\.(ts|tsx)$/, '')
  if (!basename) continue
  const semantic = basename.replace(/[-_](?:v\d+|new|old|legacy|final|backup)$/i, '')
  const list = duplicates.get(semantic) ?? []
  list.push(path)
  duplicates.set(semantic, list)
}
const suspicious = [...duplicates.entries()].filter(([, paths]) => paths.length > 1 && paths.some((path) => /(?:legacy|old|backup|copy|final|new|v\d+)/i.test(path)))
if (suspicious.length) failures.push(`Suspicious duplicate-style source names found: ${suspicious.map(([name, paths]) => `${name}=${paths.join(',')}`).join(' | ')}`)

const result = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  fileCount: files.length,
  sourceFileCount: trackedLike.length,
  canonicalCapabilityCount: Object.keys(CANONICAL_CAPABILITY_LEDGER).length,
  canonicalCapabilityLedger: CANONICAL_CAPABILITY_LEDGER,
  requiredArchitectureFiles: required,
  findings: failures,
  status: failures.length ? 'FAILED' : 'PASSED',
}
console.log(JSON.stringify(result, null, 2))
if (failures.length) process.exit(1)
