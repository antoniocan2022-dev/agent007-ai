import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOTS = ['src/lib', 'tests', 'scripts']
const TEXT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs'])
const AUDIT_FILE = 'scripts/provider-control-plane-audit.ts'
const violations: string[] = []

function walk(root: string): string[] {
  const results: string[] = []
  for (const entry of readdirSync(root)) {
    const path = join(root, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) results.push(...walk(path))
    else if (TEXT_EXTENSIONS.has(path.slice(path.lastIndexOf('.')))) results.push(path)
  }
  return results
}
function stripComments(content: string): string { return content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1') }
function isHistoricalArtifact(path: string): boolean { return /(^|\/)(backup|backups)(\/|$)/i.test(path) || /generate-(?:full-backup-final|u78-backup)\.ts$/i.test(path) }
function isTestPath(path: string): boolean { return /(^|\/).*\.test\.(?:ts|tsx|js|mjs|cjs)$/i.test(path) }

const files = ROOTS.flatMap(walk)
const contents = files.map((path) => [path, readFileSync(path, 'utf8')] as const)
const runtimeConfigPattern = /export const PROVIDER_RUNTIME_CONFIG\s*(?::[^=]+)?=/
const governedModelPattern = /export const GOVERNED_MODEL_PROFILES\s*(?::[^=]+)?=/
const legacyModelPattern = /export const MODEL_PROFILES\s*(?::[^=]+)?=/
const expectedProviderOrder = ['groq', 'cloudflare', 'mistral', 'cerebras', 'openrouter'] as const

const runtimeConfigDefs = contents.filter(([, content]) => runtimeConfigPattern.test(content)).map(([path]) => path)
if (runtimeConfigDefs.length !== 1 || runtimeConfigDefs[0] !== 'src/lib/provider-control-plane.ts') violations.push(`Expected exactly one canonical PROVIDER_RUNTIME_CONFIG in src/lib/provider-control-plane.ts; found ${runtimeConfigDefs.join(', ') || 'none'}`)
const canonicalModelDefs = contents.filter(([, content]) => governedModelPattern.test(content)).map(([path]) => path)
if (canonicalModelDefs.length !== 1 || canonicalModelDefs[0] !== 'src/lib/provider-control-plane.ts') violations.push(`Expected exactly one canonical GOVERNED_MODEL_PROFILES in src/lib/provider-control-plane.ts; found ${canonicalModelDefs.join(', ') || 'none'}`)

for (const [path, rawContent] of contents) {
  if (legacyModelPattern.test(rawContent)) {
    const isApprovedCompatibilityAlias = path === 'src/lib/model-intelligence.ts' && /export const MODEL_PROFILES\s*:\s*readonly GovernedModelProfile\[\]\s*=\s*GOVERNED_MODEL_PROFILES/.test(rawContent)
    if (!isApprovedCompatibilityAlias) violations.push(`Duplicate or legacy provider model matrix found: ${path}`)
  }
  if (path === AUDIT_FILE || isHistoricalArtifact(path)) continue
  const content = stripComments(rawContent)
  if (!isTestPath(path)) {
    const retiredRuntimePatterns: Array<[string, RegExp]> = [
      ['zai-sdk', /z-ai-web-dev-sdk/],
      ['zai-sdk-call', /\bZAI\.(?:create|createAsync)\b|\bgetZai\s*\(/],
      ['zai-endpoint', /api\.z\.ai/i],
      ['zai-provider-id', /provider\s*[:=]\s*['"]zai['"]/i],
      ['gemini-endpoint', /generativelanguage\.googleapis\.com/i],
      ['gemini-provider-id', /provider\s*[:=]\s*['"]gemini['"]/i],
      ['gemini-model-id', /(?:models\/gemini|gemini-(?:\d|pro|flash)|@google\/gemini)/i],
    ]
    for (const [label, pattern] of retiredRuntimePatterns) if (pattern.test(content)) violations.push(`Retired provider runtime reference (${label}) found in ${path}`)
  }
  if (content.includes('__providerDiscovery') || content.includes('__agent007ProviderModelCache')) violations.push(`Stale provider discovery/cache marker found in ${path}`)
}

const packageJson = readFileSync('package.json', 'utf8')
if (/z-ai-web-dev-sdk/i.test(packageJson)) violations.push('Retired ZAI SDK remains in package.json dependencies')
const lock = readFileSync('bun.lock', 'utf8')
if (/z-ai-web-dev-sdk/i.test(lock)) violations.push('Retired ZAI SDK remains in bun.lock')

const controlPlane = readFileSync('src/lib/provider-control-plane.ts', 'utf8')
for (const required of [
  "'groq'", "'cloudflare'", "'mistral'", "'cerebras'", "'openrouter'",
  "'@cf/google/gemma-4-26b-a4b-it'", 'CLOUDFLARE_API_KEY', 'CLOUDFLARE_ACCOUNT_ID',
  'OPENROUTER_API_KEY', 'openrouter/free', 'resolveLiveCatalog', 'resolveGovernedModel',
  'clearProviderCatalogCache', 'TASK_CAPABILITIES', "'vision'", "'BILLING'", "'RATE_LIMIT'", "'AUTHENTICATION'",
]) if (!controlPlane.includes(required)) violations.push(`Control-plane required invariant missing: ${required}`)
const providerOrderMatch = controlPlane.match(/export const PROVIDER_ORDER[^=]*=\s*\[([^\]]+)\]/s)
if (!providerOrderMatch) violations.push('Canonical PROVIDER_ORDER definition missing')
else {
  const actual = [...providerOrderMatch[1].matchAll(/'([^']+)'/g)].map((match) => match[1])
  if (actual.join(',') !== expectedProviderOrder.join(',')) violations.push(`Canonical provider order drift: ${actual.join(' → ')}`)
}

const runtime = readFileSync('src/lib/provider-runtime-v2.ts', 'utf8')
for (const state of ['credential', 'network', 'catalog', 'governedModel', 'taskCapability', 'execution', 'latency', 'rateLimit', 'billing', 'circuitBreaker']) if (!runtime.includes(`${state}:`)) violations.push(`Provider Control Tower state missing: ${state}`)
if (!runtime.includes("taskType = request?.taskType ?? 'reasoning'")) violations.push('Provider probes must default to reasoning rather than operations')
if (!runtime.includes('probeAllProviders')) violations.push('Full canonical provider probe function missing')
if (!runtime.includes('recordProviderError') || !runtime.includes('recordProviderSuccess')) violations.push('Provider error lifecycle telemetry is not connected to execution')

const lifecycle = readFileSync('src/lib/ceo-cognitive-lifecycle.ts', 'utf8')
for (const required of ['attemptValidatedReasoningProvider', 'stageExclusions', 'tryDegraded', 'probeProvider']) if (!lifecycle.includes(required)) violations.push(`CEO availability/resilience contract missing: ${required}`)
const releaseHealth = readFileSync('src/app/api/release-health/route.ts', 'utf8')
for (const required of ['tripletProof', 'githubMainSha', 'vercelDeploymentSha', 'releaseHealthSha', 'evidenceHierarchy', 'cspInterpretation']) if (!releaseHealth.includes(required)) violations.push(`Release proof invariant missing: ${required}`)
const canary = readFileSync('src/app/api/health/provider-canary/route.ts', 'utf8')
for (const required of ['ceo-reasoning', 'executionValidated', 'acceptableLatency', 'PROVIDER_ORDER']) if (!canary.includes(required)) violations.push(`Production provider canary invariant missing: ${required}`)
const modelIntelligence = readFileSync('src/lib/model-intelligence.ts', 'utf8')
if (!modelIntelligence.includes("from './provider-control-plane'")) violations.push('Model intelligence must derive from the canonical control plane')

if (violations.length) {
  console.error('Provider control plane audit FAILED')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exit(1)
}
console.log(`Provider control plane audit PASSED: ${files.length} source/test files scanned; canonical providers: ${expectedProviderOrder.join(', ')}`)